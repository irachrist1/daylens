export function claudeDesktopConfigDisplayPath(platform: NodeJS.Platform): string {
  if (platform === 'win32') return '%APPDATA%\\Claude\\claude_desktop_config.json'
  if (platform === 'linux') return '~/.config/Claude/claude_desktop_config.json'
  return '~/Library/Application Support/Claude/claude_desktop_config.json'
}
