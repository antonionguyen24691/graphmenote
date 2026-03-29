param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("start", "beat", "finish", "overview", "runs")]
  [string]$Action,

  [Parameter(Position = 1)]
  [string]$RunId,

  [string]$WorkspacePath = (Get-Location).Path,
  [string]$ToolSource = "codex",
  [string]$Summary,
  [string]$CurrentFile,
  [string]$LatestError,
  [string]$Location,
  [string]$Status = "completed",
  [string[]]$TouchedFiles = @()
)

$ErrorActionPreference = "Stop"
$graphRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cliPath = Join-Path $graphRoot "graph-cli.js"

if (-not (Test-Path $cliPath)) {
  throw "Khong tim thay graph-cli.js tai $cliPath"
}

switch ($Action) {
  "overview" {
    & node $cliPath activity-overview
    exit $LASTEXITCODE
  }

  "runs" {
    & node $cliPath activity-runs
    exit $LASTEXITCODE
  }

  "start" {
    & node $cliPath activity-start $WorkspacePath $ToolSource $Summary
    exit $LASTEXITCODE
  }

  "beat" {
    if (-not $RunId) {
      throw "Action beat can RunId"
    }

    $args = @("activity-beat", $RunId)
    if ($CurrentFile) { $args += @("--file", $CurrentFile) }
    if ($Summary) { $args += @("--summary", $Summary) }
    if ($LatestError) { $args += @("--latestError", $LatestError) }
    & node $cliPath @args
    exit $LASTEXITCODE
  }

  "finish" {
    if (-not $RunId) {
      throw "Action finish can RunId"
    }

    $args = @("activity-finish", $RunId, "--status", $Status)
    if ($Summary) { $args += @("--summary", $Summary) }
    if ($CurrentFile) { $args += @("--file", $CurrentFile) }
    if ($LatestError) { $args += @("--latestError", $LatestError) }
    if ($Location) { $args += @("--location", $Location) }
    if ($TouchedFiles.Count -gt 0) {
      $args += @("--touchedFiles", ($TouchedFiles -join ","))
    }
    & node $cliPath @args
    exit $LASTEXITCODE
  }
}
