// Electron sets process.windowsStore when the exe runs from an MSIX/AppX package.
export function isWindowsStoreBuild(
  platform: NodeJS.Platform = process.platform,
  windowsStore: boolean | undefined = process.windowsStore,
): boolean {
  return platform === 'win32' && windowsStore === true
}

export const HIDDEN_LAUNCH_ARG = '--hidden'
