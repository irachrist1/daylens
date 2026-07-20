# Local semantic-search model (DEV-180)

This directory holds the pinned on-device embedding model that powers
search-by-meaning: `Xenova/all-MiniLM-L6-v2` at the revision recorded by the
DEV-179 engine decision (`docs/specs/memory-and-entities.md` §Chosen engine).
Int8-quantized ONNX plus tokenizer files, ~24 MB on disk.

- Populate it (once, while online): `npm run models:semantic`
- Packaging: electron-builder copies `resources/models` → `<resources>/models`
  (see `extraResources` in `electron-builder.config.js`), so first-run
  semantic search works offline, per the memory specification.
- The artifact is **not** committed to git. A build made without the download
  step ships with semantic search honestly absent (Settings says why) and
  exact search untouched.
- The runtime loader (`src/main/services/semanticEmbedder.ts`) sets
  `allowRemoteModels = false` and `local_files_only`, so nothing is ever
  fetched at runtime and no text leaves the device.
