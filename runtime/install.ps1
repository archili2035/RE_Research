param([string]$GameDir = 'G:\SteamLibrary\steamapps\common\RESIDENT EVIL requiem BIOHAZARD requiem')
$ErrorActionPreference = 'Stop'
$resolvedGame = (Resolve-Path -LiteralPath $GameDir).Path
if (-not (Test-Path -LiteralPath (Join-Path $resolvedGame 'dinput8.dll'))) {
    throw 'REFramework loader not found. Install the official RE9 REFramework build first, then rerun this script.'
}
$autorun = Join-Path $resolvedGame 'reframework\autorun'
New-Item -ItemType Directory -Force -Path $autorun | Out-Null
$target = Join-Path $autorun 're9_3c_collector.lua'
if (Test-Path -LiteralPath $target) {
    $backup = "$target.backup.$([guid]::NewGuid().ToString('N'))"
    Copy-Item -LiteralPath $target -Destination $backup
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 're9_3c_collector.lua') -Destination $target
Write-Output "Installed: $target"
Write-Output 'Open REFramework > Script Generated UI > RE9 3C Collector after starting the game.'
