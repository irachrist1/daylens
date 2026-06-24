/** Format USD for usage UI — keeps sub-cent costs visible instead of rounding to $0.00. */
export function formatUsdAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}
