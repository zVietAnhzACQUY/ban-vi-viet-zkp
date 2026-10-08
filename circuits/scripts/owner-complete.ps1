$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')))
$nodePath = '.tools/node-v24.21.0-win-x64/node.exe'
& $nodePath 'circuits/scripts/setup.mjs' '--owner-contribution'
if ($LASTEXITCODE -ne 0) { throw 'Owner setup failed. Do not continue.' }
& $nodePath 'circuits/scripts/proof-tests.mjs' '--owner'
if ($LASTEXITCODE -ne 0) { throw 'Owner proof checks failed. Do not continue.' }
& $nodePath 'circuits/scripts/finalize.mjs'
if ($LASTEXITCODE -ne 0) { throw 'Finalization failed. Do not continue.' }
