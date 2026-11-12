# Starts the Yllir master screen for one campaign folder (Windows 10/11).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1 <campaign dir> [--lang it|en]
#
# Runs on Windows PowerShell 5.1 and on PowerShell 7. Avoid aliases and features that
# differ between the two. This file MUST be saved as UTF-8 with BOM: 5.1 reads a file
# without BOM as ANSI and would garble the Italian texts.
#
# Same contract as start.sh: finds Node.js >= minimum (node-version.txt) on PATH, then in
# <YLLIR_HOME>\node. When there is none, downloads the pinned Node LTS zip, checks its
# SHA256 against node-version.txt, extracts it into a temp folder and moves the inner
# folder into <YLLIR_HOME>\node, then runs launch.mjs.
#
# The console that runs this script is the lifetime of the server: launch.mjs is a child
# of it, and the .cmd shortcut keeps the window open only on failure.
#
# Environment:
#   YLLIR_HOME                  default $env:USERPROFILE\.yllir
#   YLLIR_NODE_BASE_URL         default https://nodejs.org/dist (tests use a local mirror)
#   YLLIR_NODE_SHA256_OVERRIDE  TEST ONLY: replaces the pinned sha256 of this computer.
#                               Never set it for a real run.

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest draws a progress bar that makes Windows PowerShell 5.1 very slow.
$ProgressPreference = 'SilentlyContinue'
# PowerShell 5.1 defaults to TLS 1.0/1.1 for some requests; nodejs.org needs TLS 1.2.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
# Non-ASCII messages go to the console; the .cmd shortcut has already set code page 65001.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$forward = @($args)
# A path ending in a backslash escapes the closing quote of its argument when Windows
# PowerShell 5.1 builds the command line for node.exe: drop the trailing backslash.
if ($forward.Count -gt 0 -and $forward[0].Length -gt 3) { $forward[0] = $forward[0].TrimEnd('\') }

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

# Stops the script with a message key; the top-level catch prints the matching text.
function Fail([string]$key) {
    throw "yllir:$key"
}

function Get-YllirHome {
    $yhome = $env:YLLIR_HOME
    if ([string]::IsNullOrEmpty($yhome)) { $yhome = Join-Path $env:USERPROFILE '.yllir' }
    return $yhome
}

function Read-Pin([string]$key) {
    foreach ($line in (Get-Content -LiteralPath (Join-Path $here 'node-version.txt') -Encoding UTF8)) {
        if ($line -match ('^' + [regex]::Escape($key) + '=(.*)$')) { return $Matches[1].Trim() }
    }
    return ''
}

function Test-NodeOk([string]$exe) {
    if ([string]::IsNullOrEmpty($exe) -or -not (Test-Path -LiteralPath $exe -PathType Leaf)) { return $false }
    $minimum = Read-Pin 'minimum'
    if ($minimum -notmatch '^\d+$') { return $false }
    try {
        & $exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= $minimum ? 0 : 1)" | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        # A broken or blocked executable: treat it as not usable.
        return $false
    }
}

# Deletes a folder tree, retrying a few times: antivirus scans can hold files for a moment.
function Remove-Tree([string]$path) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if (-not (Test-Path -LiteralPath $path)) { return }
        try {
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
            return
        } catch {
            Start-Sleep -Milliseconds 700
        }
    }
}

# Runs a file operation, retrying a few times when Defender or the indexer holds a file.
function Invoke-Retry([scriptblock]$action) {
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            & $action
            return
        } catch {
            if ($attempt -eq 5) { throw }
            Start-Sleep -Seconds 2
        }
    }
}

function Get-Platform {
    $arch = $env:PROCESSOR_ARCHITEW6432
    if ([string]::IsNullOrEmpty($arch)) { $arch = $env:PROCESSOR_ARCHITECTURE }
    switch ("$arch".ToUpperInvariant()) {
        'AMD64' { return 'win-x64' }
        'ARM64' { return 'win-arm64' }
        default { return $null }
    }
}

# Installs the pinned Node into <yhome>\node. The node folder is only replaced once the
# new one is complete, and the temp folder is removed on success and on failure.
function Install-Node([string]$yhome) {
    $platform = Get-Platform
    if ($null -eq $platform) { Fail 'M4' }

    $version = Read-Pin 'version'
    $expected = (Read-Pin "sha256.$platform").ToLowerInvariant()
    # TEST ONLY: see the header.
    if (-not [string]::IsNullOrEmpty($env:YLLIR_NODE_SHA256_OVERRIDE)) { $expected = $env:YLLIR_NODE_SHA256_OVERRIDE.ToLowerInvariant() }
    if ([string]::IsNullOrEmpty($version) -or [string]::IsNullOrEmpty($expected)) { Fail 'M4' }

    $base = $env:YLLIR_NODE_BASE_URL
    if ([string]::IsNullOrEmpty($base)) { $base = 'https://nodejs.org/dist' }
    $name = "node-v$version-$platform"
    $file = "$name.zip"

    # Short name: the extracted npm tree has deep paths, and the Windows 260-character limit applies.
    $tmp = Join-Path $yhome ('tmp.' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    try {
        New-Item -ItemType Directory -Force -Path $tmp | Out-Null

        Say 'M2'
        $archive = Join-Path $tmp $file
        try {
            Invoke-WebRequest -Uri "$base/v$version/$file" -OutFile $archive -UseBasicParsing -TimeoutSec 900
        } catch {
            Fail 'M5'
        }

        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash
        if (-not ($actual -ieq $expected)) { Fail 'M5' }

        $extract = Join-Path $tmp 'extract'
        Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
        $src = Join-Path $extract $name
        if (-not (Test-Path -LiteralPath (Join-Path $src 'node.exe') -PathType Leaf)) { Fail 'M4' }

        $target = Join-Path $yhome 'node'
        $old = Join-Path $yhome ('node.old-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
        $hadOld = $false
        if (Test-Path -LiteralPath $target) {
            Invoke-Retry { Move-Item -LiteralPath $target -Destination $old }
            $hadOld = $true
        }
        try {
            Invoke-Retry { Move-Item -LiteralPath $src -Destination $target }
        } catch {
            # Put the previous installation back, so no half-replaced node folder is left.
            if ($hadOld) { Invoke-Retry { Move-Item -LiteralPath $old -Destination $target } }
            throw
        }
        if ($hadOld) { Remove-Tree $old }
    } finally {
        Remove-Tree $tmp
    }
}

try {
    $yhome = Get-YllirHome
    $node = $null

    foreach ($cmd in @(Get-Command node -All -CommandType Application -ErrorAction SilentlyContinue)) {
        if (Test-NodeOk $cmd.Source) { $node = $cmd.Source; break }
    }

    $own = Join-Path (Join-Path $yhome 'node') 'node.exe'
    if ($null -eq $node -and (Test-NodeOk $own)) { $node = $own }

    if ($null -eq $node) {
        Install-Node $yhome
        if (-not (Test-NodeOk $own)) { Fail 'M4' }
        $node = $own
    }

    & $node (Join-Path $here 'launch.mjs') @forward
    exit $LASTEXITCODE
} catch {
    $key = 'M4'
    if ($_.Exception.Message -match '^yllir:(M\d+)$') { $key = $Matches[1] }
    Say $key
    exit 1
}
