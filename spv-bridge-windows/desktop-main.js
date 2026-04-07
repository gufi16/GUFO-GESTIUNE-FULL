const { app, BrowserWindow, Menu, Tray, shell, nativeImage } = require("electron")
const fs = require("fs")
const path = require("path")

const AGENT_URL = "http://127.0.0.1:48521/"
let mainWindow = null
let tray = null

process.env.GUFO_EFACTURA_CONFIG_DIR = app.getPath("userData")

function getAppIconPath() {
  const candidate = path.join(__dirname, "branding", "gufo-efactura.ico")
  return fs.existsSync(candidate) ? candidate : null
}

function startBridgeProcess() {
  try {
    const bridgeEntry = path.join(app.getAppPath(), "bridge.js")
    require(bridgeEntry)
  } catch (error) {
    console.error("[gufo-e-factura] agent startup warning", error)
  }
}

function createWindow() {
  const iconPath = getAppIconPath()
  const win = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 820,
    minHeight: 640,
    title: "Gufo e-Factura",
    autoHideMenuBar: true,
    backgroundColor: "#F4F7FB",
    icon: iconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  Menu.setApplicationMenu(null)
  win.loadURL(AGENT_URL)
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  win.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault()
      win.hide()
    }
  })

  return win
}

function createTray() {
  const iconPath = getAppIconPath()
  if (!iconPath) return

  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip("Gufo e-Factura")
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Deschide Gufo e-Factura",
        click: () => {
          if (mainWindow) {
            mainWindow.show()
            mainWindow.focus()
          }
        },
      },
      {
        label: "Deschide setup local",
        click: () => shell.openExternal(AGENT_URL),
      },
      {
        type: "separator",
      },
      {
        label: "Iesire",
        click: () => {
          app.isQuiting = true
          app.quit()
        },
      },
    ])
  )

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  startBridgeProcess()
  mainWindow = createWindow()
  createTray()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    } else if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  app.isQuiting = true
})
