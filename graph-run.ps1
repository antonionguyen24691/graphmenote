param(
  [Parameter(Position = 0)]
  [string]$WorkspacePath = (Get-Location).Path,

  [Parameter(Position = 1)]
  [string]$ToolSource = "codex",

  [Parameter(Position = 2, ValueFromRemainingArguments = $true)]
  [string[]]$CommandParts
)

$ErrorActionPreference = "Stop"

if (-not $CommandParts -or $CommandParts.Count -eq 0) {
  throw "Can truyen command can chay. Vi du: .\graph-run.ps1 C:\repo\stock codex npm run dev"
}

$graphRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cliPath = Join-Path $graphRoot "graph-cli.js"

if (-not (Test-Path $cliPath)) {
  throw "Khong tim thay graph-cli.js tai $cliPath"
}

& node $cliPath run $WorkspacePath $ToolSource @CommandParts
exit $LASTEXITCODE
