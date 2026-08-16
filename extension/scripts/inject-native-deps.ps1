# Injects the curated sqlite3 runtime files (prepared by
# prepare-native-deps.js into extension/node_modules) directly into a
# .vsix produced by `vsce package --no-dependencies`.
#
# Why this exists: `vsce package`'s automatic dependency detection
# (`--dependencies`, the default) gets confused by this repo's npm-workspace
# hoisting - it walks outside `extension/` entirely, pulling in unrelated
# repo-root files and sqlite3's full install-time dependency tree (verified
# empirically, not hypothetical - see decision.md). `--no-dependencies`
# avoids that but excludes node_modules unconditionally, with no way to
# override via .vscodeignore (also verified empirically). This script
# bridges the gap: produce a clean .vsix with --no-dependencies, then add
# exactly the files sqlite3 needs at runtime by editing the .vsix zip
# directly - it's just a zip file with an `extension/` top-level prefix.
#
# Windows-only as written (uses .NET's System.IO.Compression). On
# macOS/Linux the equivalent is `zip -r` run from inside extension/node_modules
# with paths prefixed `extension/node_modules/...`.
param(
    [string]$VsixPath
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

$extensionRoot = Split-Path -Parent $PSScriptRoot

if (-not $VsixPath) {
    $newest = Get-ChildItem -Path $extensionRoot -Filter "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $newest) {
        throw "No .vsix found in $extensionRoot - run 'vsce package --no-dependencies' first."
    }
    $VsixPath = $newest.FullName
}

if (-not (Test-Path $VsixPath)) {
    throw "VSIX not found at $VsixPath - run 'vsce package --no-dependencies' first."
}
$zip = [System.IO.Compression.ZipFile]::Open($VsixPath, 'Update')

function Add-DirToZip($zip, $sourceDir, $zipPrefix) {
    $files = Get-ChildItem -Path $sourceDir -Recurse -File
    foreach ($f in $files) {
        $relPath = $f.FullName.Substring($sourceDir.Length + 1) -replace '\\', '/'
        $entryName = "$zipPrefix/$relPath"
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entryName) | Out-Null
    }
}

foreach ($pkg in @("sqlite3", "bindings", "file-uri-to-path")) {
    $src = Join-Path $extensionRoot "node_modules\$pkg"
    if (-not (Test-Path $src)) {
        $zip.Dispose()
        throw "Expected $src to exist - run 'node scripts/prepare-native-deps.js' first."
    }
    Add-DirToZip $zip $src "extension/node_modules/$pkg"
}

$zip.Dispose()

$size = (Get-Item $VsixPath).Length / 1MB
Write-Host "Injected native deps into $VsixPath (final size: $([math]::Round($size, 2)) MB)"
