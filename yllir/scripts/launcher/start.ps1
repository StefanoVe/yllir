# Starts the Yllir master screen for one campaign folder (Windows, PowerShell 5.1).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1 <campaign dir> [--lang it|en]
#
# Same contract as start.sh: finds Node.js >= 20 on PATH, then in $YLLIR_HOME\node.
# When there is none, downloads the pinned Node LTS from node-version.txt, checks its
# SHA256 against that file, extracts it into $YLLIR_HOME\node and runs launch.mjs.
#
# Environment:
#   YLLIR_HOME                  default $env:USERPROFILE\.yllir
#   YLLIR_NODE_BASE_URL         default https://nodejs.org/dist (tests use a local mirror)
#   YLLIR_NODE_SHA256_OVERRIDE  TEST ONLY: replaces the pinned sha256 of this computer.
#                               Never set it for a real run.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$forward = @($args)

$lang = 'en'
for ($i = 0; $i -lt $forward.Count; $i++) {
    if ($forward[$i] -eq '--lang' -and ($i + 1) -lt $forward.Count) { $lang = $forward[$i + 1] }
}
if ($lang -ne 'it') { $lang = 'en' }

$texts = @{
    'M2' = @{ it = 'Preparo il programma necessario, ci vorrà un minuto…'; en = 'Setting up a required component, this takes a minute…' };
    'M4' = @{ it = "Non riesco ad avviare il master screen. Riprova; se continua, chiedi aiuto all'assistente."; en = 'I could not start the master screen. Try again; if it keeps happening, ask the assistant for help.' };
    'M5' = @{ it = 'Non riesco a scaricare il componente necessario. Controlla la connessione e riprova.'; en = 'I could not download a required component. Check your connection and try again.' }
}

function Say([string]$key) {
    [Console]::Error.WriteLine($texts[$key][$lang])
}

function Read-Pin([string]$key) {
    $line = Get-Content -Path (Join-Path $here 'node-version.txt') | Where-Object { $_ -like "$key=*" } | Select-Object -First 1
    if ($null -eq $line) { return '' }
    return $line.Substring($key.Length + 1).Trim()
}

function Test-NodeOk([string]$exe) {
    if ([string]::IsNullOrEmpty($exe) -or -not (Test-Path -LiteralPath $exe)) { return $false }
    $minimum = Read-Pin 'minimum'
    & $exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= $minimum ? 0 : 1)" | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Install-Node {
    $arch = $env:PROCESSOR_ARCHITEW6432
    if ([string]::IsNullOrEmpty($arch)) { $arch = $env:PROCESSOR_ARCHITECTURE }
    switch ($arch) {
        'AMD64' { $platform = 'win-x64' }
        'ARM64' { $platform = 'win-arm64' }
        default { Say 'M4'; return $false }
    }

    $version = Read-Pin 'version'
    $expected = (Read-Pin "sha256.$platform").ToLower()
    # TEST ONLY: see the header.
    if (-not [string]::IsNullOrEmpty($env:YLLIR_NODE_SHA256_OVERRIDE)) { $expected = $env:YLLIR_NODE_SHA256_OVERRIDE.ToLower() }
    if ([string]::IsNullOrEmpty($version) -or [string]::IsNullOrEmpty($expected)) { Say 'M4'; return $false }

    $base = $env:YLLIR_NODE_BASE_URL
    if ([string]::IsNullOrEmpty($base)) { $base = 'https://nodejs.org/dist' }
    $file = "node-v$version-$platform.zip"

    $yhome = $env:YLLIR_HOME
    if ([string]::IsNullOrEmpty($yhome)) { $yhome = Join-Path $env:USERPROFILE '.yllir' }
    try {
        New-Item -ItemType Directory -Force -Path $yhome | Out-Null
        $tmp = Join-Path $yhome ('tmp.' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    } catch { Say 'M4'; return $false }

    Say 'M2'
    $archive = Join-Path $tmp $file
    try {
        Invoke-WebRequest -Uri "$base/v$version/$file" -OutFile $archive -UseBasicParsing
    } catch {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
        Say 'M5'
        return $false
    }

    $actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLower()
    if ($actual -ne $expected) {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
        Say 'M5'
        return $false
    }

    $extract = Join-Path $tmp 'extract'
    try {
        Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
        $src = Join-Path $extract "node-v$version-$platform"
        if (-not (Test-Path -LiteralPath (Join-Path $src 'node.exe'))) { throw 'node.exe missing' }
        $target = Join-Path $yhome 'node'
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        Move-Item -LiteralPath $src -Destination $target
    } catch {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
        Say 'M4'
        return $false
    }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    return $true
}

$node = $null
$found = Get-Command node -ErrorAction SilentlyContinue
if ($null -ne $found -and (Test-NodeOk $found.Source)) { $node = $found.Source }

if ($null -eq $node) {
    $yhome = $env:YLLIR_HOME
    if ([string]::IsNullOrEmpty($yhome)) { $yhome = Join-Path $env:USERPROFILE '.yllir' }
    $own = Join-Path (Join-Path $yhome 'node') 'node.exe'
    if (Test-NodeOk $own) { $node = $own }
}

if ($null -eq $node) {
    if (-not (Install-Node)) { exit 1 }
    $yhome = $env:YLLIR_HOME
    if ([string]::IsNullOrEmpty($yhome)) { $yhome = Join-Path $env:USERPROFILE '.yllir' }
    $node = Join-Path (Join-Path $yhome 'node') 'node.exe'
    if (-not (Test-NodeOk $node)) { Say 'M4'; exit 1 }
}

& $node (Join-Path $here 'launch.mjs') @forward
exit $LASTEXITCODE
