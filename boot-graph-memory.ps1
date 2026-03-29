param()

$ErrorActionPreference = "Stop"

$graphRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $graphRoot "server.js"
$watcherScript = Join-Path $graphRoot "activity-watcher.js"
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$graphHome = if ($env:GRAPH_MEMORY_HOME) { $env:GRAPH_MEMORY_HOME } else { Join-Path $env:USERPROFILE ".graph-memory" }
$logDir = Join-Path $graphHome "logs"

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Get-NodeProcessForScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath
  )

  $escapedScript = [regex]::Escape($ScriptPath)
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -match '^node(.exe)?$' -and
      $_.CommandLine -match $escapedScript
    } |
    Select-Object -First 1
}

function Start-NodeScriptIfMissing {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,

    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $existing = Get-NodeProcessForScript -ScriptPath $ScriptPath
  if ($existing) {
    Write-Host "$Label da dang chay (PID $($existing.ProcessId))."
    return
  }

  $scriptName = [IO.Path]::GetFileNameWithoutExtension($ScriptPath)
  $stdoutLog = Join-Path $logDir "$scriptName.out.log"
  $stderrLog = Join-Path $logDir "$scriptName.err.log"
  $quotedScriptPath = '"' + $ScriptPath + '"'

  Start-Process `
    -FilePath $nodeExe `
    -WindowStyle Hidden `
    -WorkingDirectory $graphRoot `
    -ArgumentList @(
      $quotedScriptPath
    ) `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog | Out-Null

  Write-Host "Da start $Label."
}

Start-NodeScriptIfMissing -ScriptPath $serverScript -Label "Graph Memory API"
Start-NodeScriptIfMissing -ScriptPath $watcherScript -Label "Graph Memory Watcher"
