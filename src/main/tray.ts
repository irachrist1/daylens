import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'
import path from 'node:path'

let tray: Tray | null = null

export function createTray(mainWindow: BrowserWindow): void {
  // In packaged builds the assets/ folder is unpacked next to the asar.
  // In dev the assets/ folder lives at the repo root.
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon.png')
    : path.join(__dirname, '..', '..', 'build', 'icon.png')

  const raw = nativeImage.createFromPath(iconPath)
  const icon = raw.isEmpty() ? nativeImage.createEmpty() : raw.resize({ width: 16, height: 16 })

  tray = new Tray(icon)
  tray.setToolTip('Daylens')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Daylens',
      click: () => {
        mainWindow.show()
        mainWindow.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
