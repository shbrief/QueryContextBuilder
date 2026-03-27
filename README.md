# QueryContextBuilder

LLM-based CLI tool that summarizes cancer clinical metadata from a CSV file
using Claude. Each unique `source` entry gets a clinical prose summary
(under 450 WordPiece tokens, optimized for PubMedBERT embedding) added as a
`context` column.

## Setup

```bash
npm install
```

Create a `.env` file with your Anthropic API key:

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

The summarization behavior is controlled by `SYSTEM_PROMPT` at the top of [cli.js](cli.js) (lines 8–14). It instructs the model to:

- Write one-paragraph clinical case summaries in natural PubMed-style prose
- Stay under 450 WordPiece tokens (for PubMedBERT's 512-token limit)
- Spell out clinical terms as they appear in published literature, using only standard PubMed abbreviations
- Prioritize: cancer type/subtype, staging, demographics, biomarkers, treatment, and outcome

To change the prompt, edit `SYSTEM_PROMPT` directly in `cli.js`.

## Building the RAG Index

`build_rag_index.py` populates the `rag_disease` SQLite table and builds a PubMedBERT FAISS index from a disease corpus CSV. Run from the MetaHarmonizer root:

```bash
python /path/to/build_rag_index.py
```

This reads `data/corpus/cbio_disease/disease_corpus_updated.csv` and writes to `src/KnowledgeDb/vector_db.sqlite` and `src/KnowledgeDb/faiss_indexes/rag_pubmed_bert_disease.index`. Paths are configurable via `VECTOR_DB_PATH` and `FAISS_INDEX_DIR` environment variables.

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

The CLI output CSV is the input with one added `context` column containing clinical prose, e.g.:

| source | ... | context |
|--------|-----|---------|
| `AGE:58; CANCER_TYPE:PRAD; T_STAGE:T3b; ...` | ... | A 58-year-old male diagnosed with prostate adenocarcinoma, pathological stage pT3b with no distant metastasis. Gleason score 9 (4+5). The patient achieved complete remission and was living and tumor-free at 53 months follow-up. |
