# Windows Server setup

This is the packaged install. You download one setup EXE, run it on the machine
that runs Tally, and add one profile for each person. Each profile gets its own
address and its own token, and can reach only its own copy of Tally.

## What gets installed

| Part | Where | What it does |
|---|---|---|
| The server | `C:\Program Files\Tally MCP Server\app` | The MCP server and its dependencies |
| Node | `C:\Program Files\Tally MCP Server\runtime` | A pinned copy. Nothing else on the machine has to have Node |
| The service | `C:\Program Files\Tally MCP Server\service` | Registers **Tally MCP Server** in services.msc and restarts it if it stops |
| Settings | `C:\Program Files\Tally MCP Server\app\.env` | Port and data folder. Restart the service after a change |
| Profiles and tokens | `C:\ProgramData\TallyMcpServer` | The registry and the admin token. Readable by administrators only |
| Logs | `C:\ProgramData\TallyMcpServer\logs` | Service output, rolled at 10 MB |

The service listens on `127.0.0.1` only. The installer opens no firewall port.

## Before you install

Tally has no authentication of its own. Anything that can reach its XML port can
read and write the open company. So the ports matter.

1. On the server, one person's Tally is one running copy in that person's
   session. Give each copy its own port.
2. In each copy, go to **Help (F1) &gt; Settings &gt; Connectivity**, open
   **Client/Server configuration**, set TallyPrime to act as a **Server**, and
   set the port.
3. Use 9000 for the first person, 9001 for the second, and so on. Tally accepts
   9000 to 9999.
4. Note which port belongs to which person. The setup page can find them for
   you, but it can only report the company names, not who is signed in.

To set the company data path, use **Alt+Y (Data) &gt; Data Path** in that copy of
Tally. The MCP server never opens the data files itself. It only talks to a
running Tally, so the path is a Tally setting.

## Which file to download

A release carries two installers.

| File | Install it on |
|---|---|
| `TallyMcpServer-Setup-<version>-x64.exe` | 64-bit Windows. **Use this one.** |
| `TallyMcpServer-Setup-<version>-x86.exe` | 32-bit Windows only |

Every Windows Server edition from 2016 on is 64-bit only, so take the 64-bit file
unless you are installing on an old 32-bit copy of Windows.

Both carry their own copy of Node, so nothing has to be installed first. The
64-bit build uses Node 24 and the 32-bit build uses Node 22, which is the last
line that ships a 32-bit Windows build.

Check what you downloaded against the digest in the release notes:

```powershell
Get-FileHash .\TallyMcpServer-Setup-7.6.0-x64.exe -Algorithm SHA256
```

## Install

1. Run the setup EXE as an administrator.
2. Accept the install folder.
3. Choose the listening port. The default is **9500**. Do not use 9000 to 9999:
   that range belongs to Tally.
4. Finish. The setup page opens in your browser.

## Sign in to the setup page

The page asks for the admin token. It is in:

```
C:\ProgramData\TallyMcpServer\admin-token.txt
```

Only administrators can read that folder. Open the file, copy the line, paste it
into the page.

## Add a profile

1. Press **Scan**. It walks ports 9000 to 9010 and lists every Tally that
   answered, with the companies each one has open.
2. Press **Use this port** on the row you want.
3. Fill in:
   - **Profile id**: goes in the URL. Lower case letters, digits, hyphen or
     underscore. For example `ramesh`.
   - **Label** and **Windows user**: for your own records.
   - **Password**: what that person types on the consent page. At least 8
     characters. Give each person their own.
   - **Tools**: leave **Read only** unless that person needs to create or delete
     masters in Tally.
4. Press **Create profile**.

You now get two things. The **address**, which looks like:

```
http://127.0.0.1:9500/u/ramesh/mcp
```

And the **token**, shown once. Copy it now. Only its hash is kept, so it cannot
be read again. If it is lost, press **New token** on that profile.

## Connect a client

There are two ways in. Both reach the same address.

**With the password.** The client runs the OAuth flow itself. It opens a page,
the person types their profile password, and the client gets a token that
expires and refreshes. Use this where the client supports a custom MCP
connector: paste the address, and let it do the rest.

**With the token.** The client sends the token on every request:

```
Authorization: Bearer <the token>
```

Use this where the client only accepts a URL and a header. Keep the token out of
the URL: a URL ends up in logs and in browser history.

### What works today

| Client | Works |
|---|---|
| Claude Desktop, custom connector | Yes, against the loopback address |
| MCP Inspector or any local tool | Yes |
| A browser on the server itself | Yes, for the setup page and the discovery documents |
| ChatGPT on the web, Claude on the web | Not yet. They run in the cloud and cannot reach an address on your server |

The web apps need a tunnel out of the server. That is the next phase and is not
part of this install.

## Checking that it works

- **The service.** `services.msc`, look for **Tally MCP Server**. Or run
  `sc query TallyMcpServer`.
- **The address.** In a browser on the server, open
  `http://127.0.0.1:9500/.well-known/oauth-protected-resource/u/ramesh/mcp`.
  It should return JSON naming that profile. A 404 means the profile id is
  wrong.
- **Tally.** On the setup page, put the port in the form and press **Test this
  port**. It reports the companies that copy of Tally has open.

## Troubleshooting

**The setup page says the admin token is invalid.** You copied a stray space, or
the service rewrote the file. Read `admin-token.txt` again.

**A scan finds nothing.** Tally is not running, or its XML server is off. Check
**Help (F1) &gt; Settings &gt; Connectivity** in that copy of Tally.

**A scan finds one Tally when two are running.** Both copies are set to the same
port, so only the first one that started got it. Give the second one a different
port and restart it.

**The service will not start.** Read the newest file in
`C:\ProgramData\TallyMcpServer\logs`. A port already in use is the usual cause.

**Everything returns 404.** `MULTI_USER=1` is missing from
`app\.env`. Without it the per profile addresses are switched off.

## Changing a profile

Changes made on the setup page take effect at once for new connections. A
session that is already open keeps the Tally port it started with, so ask that
person to reconnect after you move their port.

Editing `profiles.json` by hand is different: the service reads that file at
start, so restart it afterwards.

## Changing settings

Edit `C:\Program Files\Tally MCP Server\app\.env` as an administrator, then
restart the service:

```powershell
Restart-Service TallyMcpServer
```

## Extra hardening

Tally itself does not check who is connecting, so any signed in user on the
server can reach any Tally port directly, whatever the MCP server does. Windows
Firewall can close that gap. This rule lets only one account reach one port:

```powershell
New-NetFirewallRule -DisplayName "Tally 9000 for ramesh" `
    -Direction Outbound -Action Allow -Protocol TCP `
    -RemoteAddress 127.0.0.1 -RemotePort 9000 `
    -LocalUser "D:(A;;CC;;;$((Get-LocalUser ramesh).SID.Value))"
```

Treat this as an extra, not a replacement. The profile token is the boundary the
MCP server enforces.

## Building the installer yourself

See [windows/README.md](../windows/README.md).
