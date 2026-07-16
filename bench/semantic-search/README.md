# Local semantic search benchmark (DEV-179)

Measures whether "the TV page with the best discount" can be found by meaning, entirely on-device, within the memory specification's 1-second budget — and which model, runtime, and index should do it.

The conclusion and measured numbers are recorded in [the memory specification](../../docs/specs/memory-and-entities.md) under **Chosen engine**.

## What it benchmarks

- **Models:** `all-MiniLM-L6-v2` and `bge-small-en-v1.5`, both int8-quantized ONNX under [transformers.js](https://huggingface.co/docs/transformers.js) — a Node-compatible, Electron-compatible local runtime with no Python dependency.
- **Indexes:** [`sqlite-vec`](https://github.com/asg017/sqlite-vec) (loaded into `node:sqlite`) against a brute-force Float32 scan baseline.
- **Data:** a deterministic synthetic year of 109,500 memory records (300/day — pages, files, meetings, work blocks), generated from a seeded PRNG. No real activity data is used or required.
- **Evidence per docs/TO-DO.md:** full-year index build time, query latency vs the 1-second budget, resident memory, CPU cost, plus a 24-probe vague-memory recall check where the query deliberately shares no wording with its target record.

## Running it

```bash
npm install        # once; approves onnxruntime-node's binary install script
npm run bench      # embeds an 8,192-record subset, extrapolates build time (~1 min)
npm run bench:full # embeds the entire synthetic year for measured build times (~6 min)
```

Model weights download once into `./.cache`; every later run is fully offline. Results are written to `results.json` (the committed copy is the run recorded in the specification).

This package is standalone on purpose: nothing here may enter the product dependency tree, so the shipping gate is unaffected.
