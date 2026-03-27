#!/usr/bin/env node
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a clinical metadata summarizer. Given semicolon-delimited clinical metadata key:value pairs, produce a concise natural-language summary optimized for PubMedBERT embedding. The summary MUST be under 450 WordPiece tokens to stay within PubMedBERT's 512-token limit after special token overhead.

Write as if composing a one-paragraph clinical case summary for a PubMed-indexed case report. Use full sentences with standard clinical phrasing that appears in PubMed abstracts. Spell out clinical terms as they appear in published literature (e.g., "diagnosis," "treatment," "adjuvant," "metastatic," "months," "follow-up," "male," "female"). Use only abbreviations that are standard in PubMed abstracts themselves (e.g., OS, PFS, CR, PR, SD, PD, TMB, ER, PR, HER2, MSI, EGFR, NSCLC). When in doubt, spell it out — PubMedBERT will encode the spelled-out form more accurately than clinical shorthand.

Prioritize clinically salient information in this order: cancer type/subtype and primary site, histological grade and staging (use proper TNM prefix notation: pT/cT, pN/cN, pM/cM), demographics (age, sex), key molecular biomarkers with units where applicable (e.g., mutations/Mb, ng/mL), treatment history and regimen, and survival/outcome with time point.

Omit missing, null, unknown, or not reported values entirely rather than stating they are absent. Do not reproduce the input key:value structure — the output must read as natural clinical prose. Output ONLY the summary text, nothing else.`;

const BATCH_SIZE = 5;
const CONCURRENT = 3;
const MODEL = "claude-haiku-4-5-20251001";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env automatically

async function callAPI(sources) {
  const userContent =
    sources.length === 1
      ? `Summarize this clinical metadata (under 25 tokens):\n"${sources[0]}"`
      : `Summarize each clinical metadata entry below (under 25 tokens each). Return a JSON array of summary strings in order.\n\n${sources.map((s, i) => `Entry ${i + 1}: "${s}"`).join("\n\n")}\n\nReturn ONLY a JSON array like ["summary1", "summary2"].`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const text = msg.content
    .map((b) => b.text || "")
    .join("")
    .trim()
    .replace(/^```json\s*/, "")
    .replace(/\s*```$/, "");

  if (sources.length === 1) return [text];
  return JSON.parse(text);
}

async function processBatch(sources) {
  try {
    const results = await callAPI(sources);
    if (results.length !== sources.length) throw new Error("Length mismatch");
    const out = {};
    sources.forEach((s, i) => {
      out[s] = results[i];
    });
    return out;
  } catch {
    // Fallback: process one at a time
    const out = {};
    for (const src of sources) {
      try {
        const [r] = await callAPI([src]);
        out[src] = r;
      } catch (e) {
        out[src] = `[ERROR: ${e.message.slice(0, 50)}]`;
      }
    }
    return out;
  }
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;

  if (!inputPath) {
    console.error("Usage: node cli.js <input.csv> [output.csv]");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY is not set. Add it to .env or export it.");
    process.exit(1);
  }

  const outPath = outputPath ?? inputPath.replace(/\.csv$/i, "_with_context.csv");

  let raw;
  try {
    raw = readFileSync(inputPath, "utf8");
  } catch {
    console.error(`Error: Cannot read file: ${inputPath}`);
    process.exit(1);
  }

  const rows = parse(raw, { columns: true, skip_empty_lines: true });

  if (rows.length === 0) {
    console.error("Error: CSV is empty");
    process.exit(1);
  }
  if (!rows[0].source) {
    console.error("Error: CSV must have a 'source' column");
    process.exit(1);
  }

  const unique = [...new Set(rows.map((r) => r.source))];
  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outPath}`);
  console.log(`Rows: ${rows.length} | Unique sources: ${unique.length}\n`);

  const batches = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    batches.push(unique.slice(i, i + BATCH_SIZE));
  }

  const summaries = {};
  let done = 0;
  let batchIdx = 0;

  const processNext = async () => {
    while (batchIdx < batches.length) {
      const idx = batchIdx++;
      const batch = batches[idx];
      const results = await processBatch(batch);
      Object.assign(summaries, results);
      done += batch.length;
      process.stdout.write(`\rProgress: ${done}/${unique.length}`);
    }
  };

  const workers = Array.from(
    { length: Math.min(CONCURRENT, batches.length) },
    () => processNext()
  );
  await Promise.all(workers);

  console.log("\n");

  const output = rows.map((row) => ({ ...row, context: summaries[row.source] ?? "" }));
  const csv = stringify(output, { header: true });
  writeFileSync(outPath, csv);
  console.log(`Done. Written to: ${outPath}`);
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
