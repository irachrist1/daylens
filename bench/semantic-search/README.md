# Local semantic search benchmark (DEV-179)

Measures whether "the TV page with the best discount" can be found by meaning, entirely on-device, within the memory specification's 1-second budget — and which model, runtime, and index should do it.

The conclusion and measured numbers are recorded in [the memory specification](../../docs/specs/memory-and-entities.md) under **Chosen engine**.

## What it benchmarks

- **Models:** pinned revisions of `all-MiniLM-L6-v2` and `bge-small-en-v1.5`, both int8-quantized ONNX under [transformers.js](https://huggingface.co/docs/transformers.js). MiniLM uses mean pooling; BGE uses CLS pooling and its recommended query instruction for queries only.
- **Runtime and index:** Electron 34 / Node 20 with [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) and [`sqlite-vec`](https://github.com/asg017/sqlite-vec), matching Daylens's desktop runtime and database driver. The benchmark uses a temporary file-backed database with the product's WAL, cache, mmap, and synchronous pragmas, closes it after indexing, and reopens it before querying.
- **Data:** a deterministic synthetic year of 109,500 memory records (300/day — pages, files, meetings, work blocks), generated from a seeded PRNG. The volume matches the 300 website visits/day in the existing heavy-year query fixture; the content is synthetic and is not a claim about a typical person's activity mix.
- **Evidence per `docs/TO-DO.md`:** measured full-year build wall time and CPU, isolated worker RSS sampled throughout bounded embedding/index batches, on-disk database size, first query after reopen, and 50-run latency against the 1-second budget. Recall@10 is calculated from actual sqlite-vec row IDs for 24 deliberately non-lexical probes, and every returned top-10 set is checked for size, ordering, and valid values.
- **Offline behavior:** model download is a separate command. Benchmark workers disable remote models and request local files only, so a missing pinned artifact fails the run instead of accessing the network. Artifact sizes and SHA-256 hashes are recorded in the results.

## Running it

```bash
npm install
npm run models:download # once, while online
npm test                # corpus and file-backed sqlite-vec regression checks
npm run bench           # 8,192-record smoke run; writes ignored smoke-results.json
npm run bench:full      # 109,500-record decision run; writes results.json
```

Only a successful full run is decision evidence; the smoke corpus is intentionally not extrapolated and cannot overwrite the committed result. `results.json` includes the exact runtime, hardware, power-source snapshots, model revisions, and dependency versions for the run recorded in the specification.

The committed result was measured on an Apple M2 Pro while drawing from battery. It supports the engine choice and resource conclusions on that machine. Native-extension loading and performance in packaged Windows, Linux, Intel macOS, and lower-powered supported machines remain implementation verification requirements rather than inferred benchmark results.

This package is standalone on purpose: nothing here may enter the product dependency tree, so the shipping gate is unaffected.
