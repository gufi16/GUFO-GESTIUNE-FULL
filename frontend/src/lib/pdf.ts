export async function openPdfInNewTab(response: Response) {
  const blob = await response.blob()
  const url = window.URL.createObjectURL(blob)
  window.open(url, "_blank", "noopener,noreferrer")
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60000)
}

export async function downloadPdfFile(response: Response, fileName: string) {
  const blob = await response.blob()
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60000)
}
