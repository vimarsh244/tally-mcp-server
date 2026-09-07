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
| `build/dependencies.json` | Pinned versions and SHA-256 digests for Node and WinSW |
| `build/render-release-notes.py` | Fills in the release notes template |
| `service/install-local-certificate.ps1` | Creates, exports and trusts the localhost HTTPS certificate |
| `service/tally-mcp-service.xml` | The WinSW service definition |
| `installer/tally-mcp.iss` | The Inno Setup script |
| `release-notes.md` | The release notes template |
| `stage/` | Written by `prepare.ps1`. Not committed |

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
# builds the server, then stages app, runtime and service into windows\stage
.\windows\build\prepare.ps1

# compile, using the version from package.json
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" "/DAppVersion=$version" windows\installer\tally-mcp.iss
```

The EXE lands in `build-output\`.

The build is 64-bit only. Node stopped shipping a 32-bit Windows build after
version 22, and every Windows Server edition from 2016 on is 64-bit.

To restage without rebuilding the TypeScript, pass `-SkipBuild`.

## In CI

`.github/workflows/windows-build.yml` does the same on `windows-latest`. It runs
when a pull request touches `windows/`, and on demand from the Actions tab.
Before compilation it runs `windows/tests/certificate-smoke.mjs` using the
staged Node runtime and certificate helper. On the disposable elevated runner,
it verifies a TLS handshake with certificate validation enabled, certificate
reuse, trust repair, uninstall/reinstall, and diagnostics for a wrong password.
The compiler also refuses a staged payload missing the certificate helper.
Either way it attaches the installer to the run.

## Publishing a release

Run the workflow by hand from the Actions tab and tick **Publish a GitHub Release
with the installer**. It then:

1. builds the setup EXE,
2. writes a `SHA256SUMS.txt` for it,
3. fills in `release-notes.md` with the version, the file name, its digest and
   size, and the pinned Node and WinSW versions,
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

`build/dependencies.json` holds the version and digest for `node.exe` and for
WinSW. `prepare.ps1` refuses a file whose digest does not match, so change the
version and the digest together.

```powershell
# Node
(Invoke-WebRequest "https://nodejs.org/dist/v24.20.0/SHASUMS256.txt" -UseBasicParsing).Content `
    -split "`n" | Select-String "win-x64/node.exe"

# WinSW
Invoke-WebRequest "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe" -OutFile winsw.exe
(Get-FileHash winsw.exe -Algorithm SHA256).Hash.ToLower()
```
