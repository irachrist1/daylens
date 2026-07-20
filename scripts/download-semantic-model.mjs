// Download the pinned local embedding model for semantic search (DEV-180).
//
// The engine decision (DEV-179, docs/specs/memory-and-entities.md §Chosen
// engine) pinned Xenova/all-MiniLM-L6-v2 at a specific revision, int8 ONNX
// (~24 MB on disk including tokenizer files). The spec requires the artifact
// to ship with the installer so first-run semantic search works offline —
// this script populates resources/models/, which electron-builder copies to
// <resources>/models. Run it once (while online) before `npm run dist:*`:
//
//   npm run models:semantic
//
// The artifact is deliberately NOT committed to git. At app runtime the
// loader (src/main/services/semanticEmbedder.ts) refuses remote fetches, so
// a build without this step ships with semantic search honestly absent and
// exact search untouched.
//
// Keep the pinned ids in sync with src/main/services/semanticEmbedder.ts.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const MODEL_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(projectRoot, 'resources', 'models')

const { env, pipeline } = await import('@huggingface/transformers')
env.allowRemoteModels = true
env.cacheDir = cacheDir

console.log(`Downloading ${MODEL_ID}@${MODEL_REVISION} into ${cacheDir}`)
const extractor = await pipeline('feature-extraction', MODEL_ID, {
  dtype: 'q8',
  revision: MODEL_REVISION,
})
await extractor.dispose?.()

const modelRoot = path.join(cacheDir, ...MODEL_ID.split('/'), MODEL_REVISION)
let totalBytes = 0
for (const relative of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']) {
  const filePath = path.join(modelRoot, relative)
  if (!fs.existsSync(filePath)) {
    console.error(`Missing expected model file after download: ${filePath}`)
    process.exit(1)
  }
  const bytes = fs.statSync(filePath).size
  totalBytes += bytes
  console.log(`  ${relative} — ${(bytes / (1024 * 1024)).toFixed(2)} MB`)
}
console.log(`Done. ${(totalBytes / (1024 * 1024)).toFixed(2)} MB total; ships via extraResources → <resources>/models.`)
