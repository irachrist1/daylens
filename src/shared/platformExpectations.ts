export function getWorkspaceDeviceLabel(hostname?: string | null): string {
  const trimmed = (hostname ?? '').trim()
  return trimmed.length > 0 ? trimmed : 'This device'
}
