const { contextBridge } = require("electron")

contextBridge.exposeInMainWorld("gufoDesktop", {
  appName: "Gufo e-Factura",
  mode: "desktop",
})
