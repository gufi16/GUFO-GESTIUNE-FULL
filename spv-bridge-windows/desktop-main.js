const { app, BrowserWindow, shell } = require("electron")
const { spawn } = require("child_process")
const path = require("path")

const AGENT_URL = "http://127.0.0.1:48521/"
let bridgeProcess = null

function startBridgeProcess() {
  if (bridgeProcess) return
  bridgeProcess = spawn(process.execPath, [path.join(__dirname, "bridge.js")], {
    cwd: __dirname,
    windowsHide: true,
    stdio: "ignore",
  })

  bridgeProcess.on("exit", () => {
    bridgeProcess = null
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 820,
    minHeight: 640,
    title: "Gufo e-Factura",
    autoHideMenuBar: true,
    backgroundColor: "#F4F7FB",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadURL(AGENT_URL)
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })
}

app.whenReady().then(() => {
  startBridgeProcess()
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  if (bridgeProcess && !bridgeProcess.killed) {
    bridgeProcess.kill()
  }
})
