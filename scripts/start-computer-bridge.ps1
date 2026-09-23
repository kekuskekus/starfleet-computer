param([string]$FoundryOrigin = '')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not $FoundryOrigin) { $FoundryOrigin = Read-Host 'Foundry address (for example https://foundry.srubov.cc)' }
$siteUri = [Uri]$FoundryOrigin
if ($siteUri.Scheme -notin @('https', 'http') -or -not $siteUri.Host) { throw 'Enter a valid Foundry HTTP/HTTPS address.' }
$env:STARFLEET_FOUNDRY_ORIGINS = $siteUri.GetLeftPart([UriPartial]::Authority)
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required.' }
if (-not (Test-Path -LiteralPath 'node_modules/@modelcontextprotocol/sdk/package.json')) {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
if (-not $env:STARFLEET_CODEX_BIN) {
  $codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
  if ($codexCommand) { $env:STARFLEET_CODEX_BIN = $codexCommand.Source }
  else {
    $bundledCodex = Get-ChildItem -Path "$env:LOCALAPPDATA/OpenAI/Codex/bin/*/codex.exe" -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($bundledCodex) { $env:STARFLEET_CODEX_BIN = $bundledCodex.FullName }
    else { throw 'Set STARFLEET_CODEX_BIN to the actual Codex executable, or install Codex.' }
  }
}
Write-Host 'Leave this window open while testing. Copy the local pairing code into Computer.'
& node.exe bridge/server.js
if ($LASTEXITCODE -ne 0) { throw 'Bridge exited with an error.' }
