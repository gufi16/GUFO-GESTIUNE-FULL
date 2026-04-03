const { app, BrowserWindow, Menu, Tray, shell, nativeImage, dialog } = require("electron")
const { fork } = require("child_process")
const fs = require("fs")
const path = require("path")

const AGENT_URL = "http://127.0.0.1:48521/"
let bridgeProcess = null
let mainWindow = null
let tray = null

function getAppIconPath() {
  const candidate = path.join(__dirname, "branding", "gufo-efactura.ico")
  return fs.existsSync(candidate) ? candidate : null
}

function startBridgeProcess() {
  if (bridgeProcess) return
  const bridgeEntry = path.join(app.getAppPath(), "bridge.js")
  bridgeProcess = fork(bridgeEntry, [], {
    cwd: path.dirname(bridgeEntry),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
    execPath: process.execPath,
    windowsHide: true,
    stdio: "ignore",
  })

  bridgeProcess.on("exit", () => {
    bridgeProcess = null
  })

  bridgeProcess.on("error", (error) => {
    dialog.showErrorBox(
      "Gufo e-Factura",
      `Nu am putut porni agentul local.\n\n${String(error.message || error)}`
    )
  })
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
  if (bridgeProcess && !bridgeProcess.killed) {
    bridgeProcess.kill()
  }
})
