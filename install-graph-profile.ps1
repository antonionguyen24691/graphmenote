param()

$ErrorActionPreference = "Stop"

$graphRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$graphRunPath = Join-Path $graphRoot "graph-run.ps1"
$graphActivityPath = Join-Path $graphRoot "graph-activity.ps1"
$profilePath = $PROFILE.CurrentUserCurrentHost
$profileDir = Split-Path -Parent $profilePath

if (-not (Test-Path $graphRunPath)) {
  throw "Khong tim thay graph-run.ps1 tai $graphRunPath"
}

if (-not (Test-Path $graphActivityPath)) {
  throw "Khong tim thay graph-activity.ps1 tai $graphActivityPath"
}

if (-not (Test-Path $profileDir)) {
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

$startMarker = "# >>> Graph Memory >>>"
$endMarker = "# <<< Graph Memory <<<"

$block = @"
$startMarker
function grun {
  param(
    [Parameter(Position = 0)]
    [string]`$ToolSource = "codex",

    [Parameter(Position = 1, ValueFromRemainingArguments = `$true)]
    [string[]]`$CommandParts
  )

  if (-not `$CommandParts -or `$CommandParts.Count -eq 0) {
    throw "Can truyen command can chay. Vi du: grun codex npm run dev"
  }

  & "$graphRunPath" (Get-Location).Path `$ToolSource @CommandParts
}

function grunat {
  param(
    [Parameter(Mandatory = `$true, Position = 0)]
    [string]`$WorkspacePath,

    [Parameter(Position = 1)]
    [string]`$ToolSource = "codex",

    [Parameter(Position = 2, ValueFromRemainingArguments = `$true)]
    [string[]]`$CommandParts
  )

  if (-not `$CommandParts -or `$CommandParts.Count -eq 0) {
    throw "Can truyen command can chay. Vi du: grunat C:\repo\stock codex npm run dev"
  }

  & "$graphRunPath" `$WorkspacePath `$ToolSource @CommandParts
}

function gactivity {
  param(
    [Parameter(Mandatory = `$true, Position = 0)]
    [ValidateSet("start", "beat", "finish", "overview", "runs")]
    [string]`$Action,

    [Parameter(Position = 1)]
    [string]`$RunId,

    [string]`$Summary,
    [string]`$CurrentFile,
    [string]`$LatestError,
    [string]`$Location,
    [string]`$Status = "completed",
    [string[]]`$TouchedFiles = @(),
    [string]`$ToolSource = "codex",
    [string]`$WorkspacePath = (Get-Location).Path
  )

  switch (`$Action) {
    "overview" {
      & "$graphActivityPath" overview
      return
    }

    "runs" {
      & "$graphActivityPath" runs
      return
    }

    "start" {
      & "$graphActivityPath" start -WorkspacePath `$WorkspacePath -ToolSource `$ToolSource -Summary `$Summary
      return
    }

    "beat" {
      if (-not `$RunId) {
        throw "Action beat can RunId"
      }

      & "$graphActivityPath" beat `$RunId -CurrentFile `$CurrentFile -Summary `$Summary -LatestError `$LatestError
      return
    }

    "finish" {
      if (-not `$RunId) {
        throw "Action finish can RunId"
      }

      & "$graphActivityPath" finish `$RunId -Status `$Status -CurrentFile `$CurrentFile -Summary `$Summary -LatestError `$LatestError -Location `$Location -TouchedFiles `$TouchedFiles
    }
  }
}
$endMarker
"@

$currentContent = if (Test-Path $profilePath) {
  Get-Content -Path $profilePath -Raw
} else {
  ""
}

$pattern = "(?ms)$([regex]::Escape($startMarker)).*?$([regex]::Escape($endMarker))"

if ([regex]::IsMatch($currentContent, $pattern)) {
  $updatedContent = [regex]::Replace($currentContent, $pattern, $block.Trim())
} elseif ([string]::IsNullOrWhiteSpace($currentContent)) {
  $updatedContent = $block.Trim()
} else {
  $updatedContent = $currentContent.TrimEnd() + "`r`n`r`n" + $block.Trim()
}

Set-Content -Path $profilePath -Value ($updatedContent + "`r`n") -Encoding UTF8

Write-Host "Da cap nhat PowerShell profile: $profilePath"
Write-Host "Mo terminal moi, sau do dung:"
Write-Host "  grun codex npm run dev"
Write-Host "  grunat C:\repo\stock codex npm run dev"
Write-Host "  gactivity overview"
