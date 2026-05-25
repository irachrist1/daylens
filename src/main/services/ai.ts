// Public AI service surface.
// The implementation lives under jobs while IPC/tests keep importing this path.
// Prompt policy preserved by the implementation:
// Never use raw app names as the activity
// Describe activity, work threads, artifacts, pages, or context instead of listing tool names as nouns.
export * from '../jobs/aiService'
