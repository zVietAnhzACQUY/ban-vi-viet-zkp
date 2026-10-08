param([string]$PrivateDirectory = (Join-Path $env:LOCALAPPDATA 'BanViViet\issuer'))
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location -LiteralPath $projectRoot
$privatePath = [IO.Path]::GetFullPath($PrivateDirectory)
if ($privatePath.Equals($projectRoot, [StringComparison]::OrdinalIgnoreCase) -or $privatePath.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Private directory must be outside the repository.' }
if (Test-Path -LiteralPath $privatePath) { throw 'Choose a NEW directory dedicated to Issuer keys. Existing directories are not modified.' }
if (Test-Path -LiteralPath 'artifacts/issuer-public.json') { throw 'Issuer public keys already exist. Explicit key rotation required.' }
$confirmation = Read-Host 'Ban truc tiep giu khoa Issuer tren may nay? Go TOI'
if ($confirmation -cne 'TOI') { throw 'Cancelled' }
New-Item -ItemType Directory -Path $privatePath | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $privatePath /inheritance:r /grant:r "${identity}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict directory ACL; no keys generated.' }
& '.tools/node-v24.21.0-win-x64/node.exe' 'circuits/scripts/issuer-keygen.mjs' '--restricted-directory' $privatePath
if ($LASTEXITCODE -ne 0) { throw 'Key generation failed. Inspect locally; never send private files.' }
