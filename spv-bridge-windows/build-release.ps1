$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseRoot = Join-Path $scriptDir "release"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$appDir = Join-Path $releaseRoot "Gufo e-Factura $timestamp"
$repoRoot = Split-Path -Parent $scriptDir
$vendorDir = Join-Path $appDir "vendor"
$nodeSource = (Get-Command node -ErrorAction Stop).Source
$admZipSource = Join-Path $repoRoot "backend\node_modules\adm-zip"

New-Item -ItemType Directory -Force -Path $appDir | Out-Null
New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null

$files = @(
  "bridge.js",
  "desktop-main.js",
  "package.json",
  "preload.js",
  ".env.example",
  "README.md",
  "install-agent.ps1",
  "start-agent.ps1",
  "uninstall-agent.ps1"
)

foreach ($file in $files) {
  Copy-Item (Join-Path $scriptDir $file) (Join-Path $appDir $file) -Force
}

Copy-Item (Join-Path $scriptDir ".env.example") (Join-Path $appDir ".env") -Force

Copy-Item $nodeSource (Join-Path $appDir "node.exe") -Force
Copy-Item $admZipSource (Join-Path $vendorDir "adm-zip") -Recurse -Force

$brandingDir = Join-Path $scriptDir "branding"
if (Test-Path $brandingDir) {
  Copy-Item $brandingDir (Join-Path $appDir "branding") -Recurse -Force
}

$configureCmd = @"
@echo off
cd /d "%~dp0"
wscript.exe ".\open-gufo-efactura.vbs"
pause
"@

$installCmd = @"
@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File ".\install-agent.ps1"
start "" http://127.0.0.1:48521/
pause
"@

$startCmd = @"
@echo off
cd /d "%~dp0"
wscript.exe ".\open-gufo-efactura.vbs"
pause
"@

Set-Content -Path (Join-Path $appDir "Configureaza Gufo e-Factura.cmd") -Value $configureCmd -Encoding ASCII
Set-Content -Path (Join-Path $appDir "Instaleaza Gufo e-Factura.cmd") -Value $installCmd -Encoding ASCII
Set-Content -Path (Join-Path $appDir "Porneste Gufo e-Factura.cmd") -Value $startCmd -Encoding ASCII

$openUiVbs = @"
Set shell = CreateObject("WScript.Shell")
appUrl = "http://127.0.0.1:48521/"

shell.Run "schtasks /run /TN ""Gufo e-Factura""", 0, False
WScript.Sleep 1500

edgePath = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe")
If edgePath = "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" Then
  edgePath = shell.ExpandEnvironmentStrings("%ProgramFiles%\Microsoft\Edge\Application\msedge.exe")
End If

If CreateObject("Scripting.FileSystemObject").FileExists(edgePath) Then
  shell.Run Chr(34) & edgePath & Chr(34) & " --app=" & appUrl, 1, False
Else
  shell.Run appUrl, 1, False
End If
"@

Set-Content -Path (Join-Path $appDir "open-gufo-efactura.vbs") -Value $openUiVbs -Encoding ASCII

Write-Host ""
Write-Host "Release folder pregatit:" -ForegroundColor Green
Write-Host $appDir
Write-Host ""
Write-Host "Pasul urmator: impachetare installer sau arhiva."
