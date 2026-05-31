// The AI tab. The implementation lives in ./insights/AIWorkspace — a Codex-style
// minimal chat split into isolated, individually-memoized pieces (composer,
// message list, local-history search) so typing, streaming, and searching never
// re-render each other. This file stays as the route entry point.
export { default } from './insights/AIWorkspace'
