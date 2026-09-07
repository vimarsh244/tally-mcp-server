<#
.SYNOPSIS
    Stages everything the Windows installer packs.

.DESCRIPTION
    The payload is the built server, its production dependencies, a pinned copy
    of Node and the WinSW service wrapper. Nothing is compiled into a single
    binary on purpose: PGlite ships WebAssembly assets that a single file build
    breaks, and Node's own single file support does not accept ES modules.

    Every download is checked against the digest in dependencies.json before it
    is used.

.PARAMETER StageDir
    Where the payload is written. Removed and remade on every run.

.PARAMETER SkipBuild
    Use the committed dist/ as it is, instead of running the build first.
#>
[CmdletBinding()]
param(
    [string] $StageDir = (Join-Path $PSScriptRoot '..\stage'),
    [switch] $SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dependencies = Get-Content (Join-Path $PSScriptRoot 'dependencies.json') -Raw | ConvertFrom-Json

function Write-Step([string] $message) {
    Write-Host "==> $message" -ForegroundColor Cyan
}

<# Downloads a file and refuses it unless the digest matches. #>
function Get-PinnedFile {
    param(
        [Parameter(Mandatory)] $Pin,
        [Parameter(Mandatory)] [string] $Destination
    )

    $url = $Pin.url.Replace('{version}', $Pin.version)
    Write-Step "Downloading $url"

    $parent = Split-Path -Parent $Destination
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

    Invoke-WebRequest -Uri $url -OutFile $Destination -UseBasicParsing

    $actual = (Get-FileHash -Path $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    $expected = $Pin.sha256.ToLowerInvariant()

    if ($actual -ne $expected) {
        Remove-Item $Destination -Force
        throw "Digest mismatch for $url. Expected $expected but got $actual."
    }

    Write-Host "    digest ok"
}

# ---------------------------------------------------------------- build

if (-not $SkipBuild) {
    Write-Step 'Building the server'
    Push-Location $repoRoot
    try {
        & pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'pnpm build failed' }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path (Join-Path $repoRoot 'dist\server.mjs'))) {
    throw 'dist\server.mjs is missing. Run the build first, or drop -SkipBuild.'
}

# ---------------------------------------------------------------- stage

Write-Step "Staging into $StageDir"
if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

$appDir = Join-Path $StageDir 'app'
New-Item -ItemType Directory -Path $appDir -Force | Out-Null

Copy-Item (Join-Path $repoRoot 'dist') $appDir -Recurse
foreach ($file in @('package.json', 'pnpm-lock.yaml', 'authorize.html', 'admin.html', 'LICENSE')) {
    Copy-Item (Join-Path $repoRoot $file) $appDir
}

# The service reads the page files from the folder above dist, so authorize.html
# and admin.html have to sit next to package.json, exactly as they do in the repo.

Write-Step 'Installing production dependencies'
Push-Location $appDir
try {
    # hoisted, because the installer copies plain files and a symlinked store
    # would not survive the copy
    & pnpm install --prod --frozen-lockfile --ignore-scripts --config.node-linker=hoisted
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install --prod failed' }
} finally {
    Pop-Location
}

# the lockfile is only needed to resolve the install and must not ship
Remove-Item (Join-Path $appDir 'pnpm-lock.yaml') -Force

# ---------------------------------------------------------------- runtime

Get-PinnedFile -Pin $dependencies.node -Destination (Join-Path $StageDir 'runtime\node.exe')

$serviceDir = Join-Path $StageDir 'service'
Get-PinnedFile -Pin $dependencies.winsw -Destination (Join-Path $serviceDir 'tally-mcp-service.exe')

# WinSW reads the configuration file that sits beside it under the same name
Copy-Item (Join-Path $PSScriptRoot '..\service\tally-mcp-service.xml') $serviceDir

# ---------------------------------------------------------------- report

$version = (Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
Set-Content -Path (Join-Path $StageDir 'version.txt') -Value $version -NoNewline

$size = (Get-ChildItem $StageDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Step ("Staged version {0}, {1:N0} MB" -f $version, ($size / 1MB))
