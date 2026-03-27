# Contextuarize OntologyMapper Query

LLM-based CLI tool that summarizes cancer clinical metadata from a CSV file 
using Claude. Each unique `source` entry gets a concise (&lt;25 token) summary 
added as a `context` column.

## Setup

```bash
npm install
cp .env.example .env
# add your Anthropic API key to .env
```

**.env**
```
ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

```bash
node cli.js <input.csv> [output.csv]
```

- `input.csv` must have a `source` column containing semicolon-delimited `KEY:VALUE` metadata strings
- `output.csv` defaults to `<input>_with_context.csv` if not specified

**Example:**
```bash
node cli.js data/tcga_clinical.csv
# → writes data/tcga_clinical_with_context.csv
```

Or via npm:
```bash
npm run cli -- data/tcga_clinical.csv
```

## Customizing the Prompt

The summarization behavior is controlled by `SYSTEM_PROMPT` at the top of [cli.js](cli.js) (lines 8–12). It has two parts:

1. **Instruction text** — defines what to capture, the token budget, allowed abbreviations, and output format
2. **Few-shot example** — an `Input:` / `Output:` pair that demonstrates the expected summary style; the model closely mirrors this

To change the prompt, edit `SYSTEM_PROMPT` directly:

```js
const SYSTEM_PROMPT = `You are a clinical metadata summarizer. Given semicolon-delimited ...
// ↑ edit the instruction text

Example:
Input: "..."
Output: "..."   // ← update this to reflect your desired output style
`;
```

The few-shot example has the strongest influence on output style — update it whenever you change the token budget, field priority, or abbreviation conventions.

## Context Embedding Evaluation

`om_with_context.py` compares three query-embedding strategies (baseline, prompt-concat, hybrid average) against a FAISS+SQLite ontology index, with an optional Method 2 (contextualized token extraction).

```bash
python om_with_context.py --input <input.csv> [options]
```

**Required:**
- `--input`, `-i` — Path to input CSV (must have `term` and `context` columns)

**Options:**

| Flag | Default | Description |
|---|---|---|
| `--model`, `-m` | `pubmed-bert` | Embedding model method |
| `--category`, `-c` | `disease` | Ontology category |
| `--top-k`, `-k` | `5` | Number of top matches to return |
| `--context-keys` | 8 disease keys | Space-separated context keys to extract |
| `--output-dir`, `-o` | `data/outputs` | Output directory for CSVs and plots |
| `--skip-method2` | off | Skip Method 2 (token extraction) |
| `--skip-plots` | off | Skip plot generation |

**Examples:**
```bash
# Basic run with defaults
python om_with_context.py -i input_with_summarized_context.csv

# Custom model, category, and top-k
python om_with_context.py -i my_data.csv -m sap-bert -c disease -k 10 -o results/

# Quick run: skip slow method 2 and plots
python om_with_context.py -i my_data.csv --skip-method2 --skip-plots
```

## Output

The output CSV is the input with one added `context` column, e.g.:

| source | ... | context |
|--------|-----|---------|
| 58M, PRAD T3b/M0, Gleason 9, complete remission | ... | 58M, prostate adenocarcinoma (PRAD), Gleason 9 (4+5+3), T3b/M0, living & tumor-free at 53mo |
