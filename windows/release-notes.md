# Tally MCP Server {{VERSION}} for Windows

Serves Tally Prime data to MCP clients such as Claude. One address per Tally user
on the machine, each with its own password and token, so nobody can read another
person's books.

Install it on the machine that runs Tally. It registers a Windows service and
listens on `127.0.0.1` only.

## Download

| File | Install it on | Size |
|---|---|---|
| [{{FILE_X64}}]({{DOWNLOAD_BASE}}/{{FILE_X64}}) | 64-bit Windows. **Use this one.** | {{SIZE_X64}} |
| [{{FILE_X86}}]({{DOWNLOAD_BASE}}/{{FILE_X86}}) | 32-bit Windows only | {{SIZE_X86}} |

Windows Server 2016, 2019, 2022 and 2025 are all 64-bit only. Take the 32-bit
file only if you are installing on an old 32-bit copy of Windows.

### Check what you downloaded

```powershell
Get-FileHash .\{{FILE_X64}} -Algorithm SHA256
```

| File | SHA-256 |
|---|---|
| `{{FILE_X64}}` | `{{SHA_X64}}` |
| `{{FILE_X86}}` | `{{SHA_X86}}` |

## Install

1. **Set up Tally first.** In each person's copy of Tally, go to **Help (F1) &gt;
   Settings &gt; Connectivity &gt; Client/Server configuration**, set TallyPrime to
   act as a **Server**, and give it its own port. Use 9000 for the first person,
   9001 for the second, and so on. Two copies cannot share a port.
2. **Run the setup EXE as an administrator.** Choose a listening port when asked.
   The default of 9500 is fine. Do not use 9000 to 9999: that range belongs to
   Tally.
3. **Add a profile for each person.** The setup page opens by itself. Sign in with
   the admin token from `C:\ProgramData\TallyMcpServer\admin-token.txt`, press
   **Scan** to find the running copies of Tally, and create one profile each.

You get an address and a token per person:

```
http://127.0.0.1:9500/u/ramesh/mcp
```

Paste that into Claude Desktop as a custom connector.

The full guide is in [docs/server-setup-windows.md]({{REPO_URL}}/blob/{{TAG}}/docs/server-setup-windows.md).

## What is inside

Nothing has to be installed first. The setup EXE carries everything:

| Part | Version |
|---|---|
| Tally MCP Server | {{VERSION}} |
| Node runtime, 64-bit build | {{NODE_X64}} |
| Node runtime, 32-bit build | {{NODE_X86}} |
| WinSW service wrapper | {{WINSW}} |

The two builds pin different Node versions because Node 22 is the last line that
ships a 32-bit Windows build. Both satisfy what this project asks for.

## Worth knowing

- The service listens on `127.0.0.1` and the installer opens no firewall port.
- `C:\ProgramData\TallyMcpServer` holds the profiles and the admin token, and is
  locked to SYSTEM and the administrators.
- New profiles are **read only** until you turn writing on for that person.
- ChatGPT and Claude on the web run in the cloud and cannot reach an address on
  your own server yet. Claude Desktop and other local clients can.
- Uninstalling leaves `C:\ProgramData\TallyMcpServer` in place, so your profiles
  survive an upgrade. Delete it by hand if you are done with the server.
