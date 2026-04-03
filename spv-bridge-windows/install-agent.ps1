$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$taskName = "Gufo e-Factura"
$launcherPath = Join-Path $scriptDir "bridge-launcher.vbs"
$nodeCmd = (Get-Command node -ErrorAction Stop).Source
$bridgePath = Join-Path $scriptDir "bridge.js"
$stdoutLog = Join-Path $scriptDir "agent.stdout.log"
$stderrLog = Join-Path $scriptDir "agent.stderr.log"

if (-not (Test-Path (Join-Path $scriptDir ".env"))) {
  throw "Lipseste fisierul .env. Configureaza bridge-ul inainte de instalare."
}

$launcherContent = @"
Set shell = CreateObject("WScript.Shell")
cmd = "cmd /c cd /d ""$scriptDir"" && ""$nodeCmd"" ""$bridgePath"" 1>>""$stdoutLog"" 2>>""$stderrLog"""
shell.Run cmd, 0, False
"@

Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII

try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
} catch {
}

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$launcherPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Porneste automat Gufo e-Factura pentru certificatul local din Windows Store." `
  -User $env:USERNAME `
  -RunLevel Limited `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName

Write-Host ""
Write-Host "Gufo e-Factura a fost instalat." -ForegroundColor Green
Write-Host "Task: $taskName"
Write-Host "Launcher: $launcherPath"
Write-Host "Health: http://127.0.0.1:48521/health"
