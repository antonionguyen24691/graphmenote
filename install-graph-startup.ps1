param()

$ErrorActionPreference = "Stop"

$graphRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bootScript = Join-Path $graphRoot "boot-graph-memory.ps1"
$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$startupFile = Join-Path $startupDir "Graph Memory.cmd"

if (-not (Test-Path $bootScript)) {
  throw "Khong tim thay boot-graph-memory.ps1 tai $bootScript"
}

if (-not (Test-Path $startupDir)) {
  New-Item -ItemType Directory -Path $startupDir -Force | Out-Null
}

$cmdContent = @"
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$bootScript"
"@

Set-Content -Path $startupFile -Value $cmdContent -Encoding ASCII

Write-Host "Da cai auto-start tai: $startupFile"
Write-Host "Dang khoi dong Graph Memory nen..."
& $bootScript
