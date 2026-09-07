# Windows packaging

This folder builds `TallyMcpServer-Setup-<version>.exe`: a Windows service that
serves one MCP address per Tally user on the machine.

For installing and using it, read
[docs/server-setup-windows.md](../docs/server-setup-windows.md). This file is
about producing the EXE.

## Layout

| Path | What it is |
|---|---|
| `build/prepare.ps1` | Builds the server and stages everything the installer packs |
| `build/dependencies.json` | Pinned versions and SHA-256 digests for Node and WinSW, per architecture |
| `build/render-release-notes.py` | Fills in the release notes template |
| `service/tally-mcp-service.xml` | The WinSW service definition |
| `installer/tally-mcp.iss` | The Inno Setup script |
| `release-notes.md` | The release notes template |
| `stage-x64/`, `stage-x86/` | Written by `prepare.ps1`. Not committed |

## Architectures

Two installers are built, `-x64` and `-x86`.

The server payload is byte for byte the same in both. Nothing in it is a native
module: PGlite is WebAssembly and everything else is plain JavaScript. Only
`node.exe` and the service wrapper differ.

| | 64-bit | 32-bit |
|---|---|---|
| Node | 24 LTS | 22 LTS |
| Runs on | 64-bit Windows | 32-bit Windows, and 64-bit Windows as a 32-bit program |

The Node versions differ because **Node 22 is the last line that ships a 32-bit
Windows build**. Node 24 dropped it. `package.json` asks for Node 22 or newer, so
both are fine. When Node 22 goes out of maintenance the 32-bit installer will
have to stay on it, or be dropped.

Almost nobody needs the 32-bit one. Every Windows Server edition from 2016 on is
64-bit only. It exists for old 32-bit desktop Windows running Tally.

Both builds share one `AppId`, so installing one replaces the other rather than
sitting beside it. They register the same Windows service name, so two of them
could never run together anyway.

## Why there is no single binary

Two things rule it out. Node's own single executable support takes a CommonJS
script, and this project is ES modules throughout. PGlite, which backs the
result cache, ships WebAssembly assets that a single file build drops.

So the payload is the ordinary build plus its production dependencies, a pinned
`node.exe`, and WinSW to run it as a service. Inno Setup wraps all of it in one
setup EXE, which is what somebody downloads and runs.

## Build it

Needs Windows, pnpm, and [Inno Setup 6](https://jrsoftware.org/isdl.php).

```powershell
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"

foreach ($arch in 'x64', 'x86') {
    # builds the server, then stages app, runtime and service
    .\windows\build\prepare.ps1 -Arch $arch
    & $iscc "/DAppVersion=$version" "/DArch=$arch" windows\installer\tally-mcp.iss
}
```

Both EXEs land in `build-output\`.

To restage without rebuilding the TypeScript, pass `-SkipBuild`.

## In CI

`.github/workflows/windows-build.yml` does the same on `windows-latest`, once per
architecture. It runs when a pull request touches `windows/`, and on demand from
the Actions tab. Either way it attaches both installers to the run.

## Publishing a release

Run the workflow by hand from the Actions tab and tick **Publish a GitHub Release
with both installers**. It then:

1. builds `x64` and `x86`,
2. writes a `SHA256SUMS.txt` covering both,
3. fills in `release-notes.md` with the version, the file names, their digests and
   sizes, and the pinned Node and WinSW versions,
4. creates the release at the commit the workflow ran on.

The other inputs:

| Input | What it does |
|---|---|
| Release tag | Defaults to `v<version from package.json>` |
| Draft | Creates it as a draft so you can read it before it goes out |
| Prerelease | Marks it as a prerelease |

Running it again on the same tag replaces the notes and the assets rather than
failing, so a bad release can be fixed by re-running.

To check how the notes will read without running anything:

```bash
python3 windows/build/render-release-notes.py \
    --version 7.6.0 --tag v7.6.0 \
    --repo-url https://github.com/vimarsh244/tally-mcp-server \
    --installer-dir build-output
```

## Updating a pinned download

`build/dependencies.json` holds a version and a digest for `node.exe` and for
WinSW, under each architecture. `prepare.ps1` refuses a file whose digest does not
match, so change the version and the digest together.

```powershell
# Node. Use win-x64 under the x64 entry and win-x86 under the x86 entry.
(Invoke-WebRequest "https://nodejs.org/dist/v24.20.0/SHASUMS256.txt" -UseBasicParsing).Content `
    -split "`n" | Select-String "win-x64/node.exe"

# WinSW
Invoke-WebRequest "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe" -OutFile winsw.exe
(Get-FileHash winsw.exe -Algorithm SHA256).Hash.ToLower()
```

A Node line with no `win-x86/node.exe` entry has no 32-bit build. That is why the
x86 pin is on Node 22.
