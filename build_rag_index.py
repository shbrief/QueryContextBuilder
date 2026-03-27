"""Build rag_disease table + pubmed-bert FAISS index from disease_corpus_updated.csv.

Run from MetaHarmonizer root:
    python /path/to/build_rag_index.py
"""
import os, sys
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
# Must NOT call load_dotenv() before imports — model_loader.py does it internally
# and calling it again before import triggers a multiprocessing crash on macOS.
sys.path.insert(0, '.')

if __name__ == '__main__':
    # NOTE: faiss must be imported AFTER model.encode() — importing it before
    # causes a threading conflict that silently crashes the encode call on macOS.
    import sqlite3, numpy as np, pandas as pd
    from src.utils.model_loader import get_embedding_model_cached

    DB_PATH  = os.getenv('VECTOR_DB_PATH', 'src/KnowledgeDb/vector_db.sqlite')
    IDX_DIR  = os.getenv('FAISS_INDEX_DIR', 'src/KnowledgeDb/faiss_indexes')
    IDX_PATH = os.path.join(IDX_DIR, 'rag_pubmed_bert_disease.index')

    # 1. Load corpus CSV
    df = pd.read_csv('data/corpus/cbio_disease/disease_corpus_updated.csv')
    df = df[['label', 'clean_code', 'description']].dropna()
    print(f'Corpus rows: {len(df)}')

    # 2. Populate rag_disease table
    conn = sqlite3.connect(DB_PATH)
    cur  = conn.cursor()
    cur.execute('DELETE FROM rag_disease')
    records = [(row['label'], row['clean_code'], row['description']) for _, row in df.iterrows()]
    cur.executemany('INSERT OR IGNORE INTO rag_disease (term, code, context) VALUES (?,?,?)', records)
    conn.commit()
    count = cur.execute('SELECT COUNT(*) FROM rag_disease').fetchone()[0]
    print(f'rag_disease rows: {count}')

    # 3. Build embeddings + FAISS index
    raw_model = get_embedding_model_cached('pubmed-bert')
    texts = df['label'].tolist()
    print(f'Embedding {len(texts)} texts...')
    mat = raw_model.encode(
        texts,
        batch_size=64,
        show_progress_bar=True,
        normalize_embeddings=True,
        convert_to_numpy=True,
    ).astype('float32')
    print(f'Embedding matrix: {mat.shape}')

    # 4. Build FAISS index (import faiss only after encoding to avoid threading conflict)
    import faiss
    index = faiss.IndexFlatIP(mat.shape[1])
    index.add(mat)
    print(f'FAISS ntotal: {index.ntotal}')

    os.makedirs(IDX_DIR, exist_ok=True)
    faiss.write_index(index, IDX_PATH)
    print(f'Saved index -> {IDX_PATH}')
    conn.close()
