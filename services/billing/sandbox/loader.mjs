// ESM resolve hook (dev-only). Redirects `import ... from 'pg'` to the in-memory
// pg-shim so the billing server runs with no real Postgres. Registered by
// sandbox/run.mjs before it imports the server. Affects nothing else: any other
// specifier falls through to Node's default resolver.
const shim = new URL('./pg-shim.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'pg') return { url: shim, shortCircuit: true }
  return nextResolve(specifier, context)
}
