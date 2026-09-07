; Inno Setup script for the Tally MCP Server Windows service.
;
; Compile with:
;   iscc /DAppVersion=7.6.0 windows\installer\tally-mcp.iss
;
; It expects windows\stage to be filled by windows\build\prepare.ps1.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName        "Tally MCP Server"
#define ServiceName    "TallyMcpServer"
#define DataDir        "{commonappdata}\TallyMcpServer"
#define DefaultPort    "9500"
#define StageDir       "..\stage"
#define PfxPassword    "tally-mcp-localhost-2026"

; A wildcard service payload otherwise compiles even when this helper is absent.
#ifnexist StageDir + "\service\install-local-certificate.ps1"
  #error "Certificate helper missing. Run windows\build\prepare.ps1 before compiling."
#endif

[Setup]
; keep this GUID for the life of the product, or upgrades install side by side
AppId={{7C4F2E18-9A31-4B6D-9E0C-2F8B5A1D7C43}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Tally MCP Server contributors
DefaultDirName={autopf}\Tally MCP Server
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=..\..\build-output
OutputBaseFilename=TallyMcpServer-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
; the service, Program Files and the data folder ACL all need elevation
PrivilegesRequired=admin
; 64-bit only: Node stopped shipping a 32-bit Windows build after version 22,
; and every Windows Server edition from 2016 on is 64-bit anyway
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
UninstallDisplayName={#AppName}
LicenseFile={#StageDir}\app\LICENSE

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#StageDir}\app\*";     DestDir: "{app}\app";     Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#StageDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#StageDir}\service\*"; DestDir: "{app}\service"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
; made before the service starts, so the registry and the admin token inherit
; the restricted list this installer puts on it
Name: "{#DataDir}"

[Icons]
Name: "{group}\Settings and tokens folder"; Filename: "{#DataDir}"
Name: "{group}\Service log folder"; Filename: "{#DataDir}\logs"

[INI]
; an internet shortcut, because a .lnk cannot point at a URL
Filename: "{group}\Tally MCP Server setup.url"; Section: "InternetShortcut"; Key: "URL"; String: "{code:GetSetupUrl}"

[Run]
Filename: "{code:GetSetupUrl}"; Description: "Open the setup page"; Flags: postinstall shellexec nowait

[UninstallDelete]
Type: files; Name: "{group}\Tally MCP Server setup.url"
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"

[Code]
var
  PortPage: TInputQueryWizardPage;

function ServiceExe: String;
begin
  Result := ExpandConstant('{app}\service\tally-mcp-service.exe');
end;

function ChosenPort: String;
begin
  Result := Trim(PortPage.Values[0]);
  if Result = '' then
    Result := '{#DefaultPort}';
end;

function GetSetupUrl(Param: String): String;
begin
  Result := 'https://localhost:' + ChosenPort + '/admin';
end;

procedure InitializeWizard;
begin
  PortPage := CreateInputQueryPage(wpSelectDir,
    'Listening port',
    'Which port should the service listen on?',
    'The service listens on this machine only, at 127.0.0.1. Do not use 9000 to 9999:' + #13#10 +
    'Tally itself uses that range for its XML server.');
  PortPage.Add('Port:', False);
  PortPage.Values[0] := '{#DefaultPort}';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Port: Integer;
begin
  Result := True;
  if CurPageID <> PortPage.ID then
    Exit;

  Port := StrToIntDef(Trim(PortPage.Values[0]), -1);

  if (Port < 1) or (Port > 65535) then
  begin
    MsgBox('Enter a port between 1 and 65535.', mbError, MB_OK);
    Result := False;
    Exit;
  end;

  if (Port >= 9000) and (Port <= 9999) then
  begin
    if MsgBox('Tally uses ports 9000 to 9999 for its own XML server. Using ' +
              IntToStr(Port) + ' can stop a copy of Tally from starting.' + #13#10#13#10 +
              'Use it anyway?', mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;

// Runs a program and waits, returning False when it could not be started.
function RunAndWait(FileName, Params: String; var ResultCode: Integer): Boolean;
begin
  Result := Exec(FileName, Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// Stops and removes the service, ignoring the case where it is not installed.
procedure RemoveService;
var
  ResultCode: Integer;
begin
  if not FileExists(ServiceExe) then
    Exit;

  RunAndWait(ServiceExe, 'stop', ResultCode);
  RunAndWait(ServiceExe, 'uninstall', ResultCode);
end;

// Locks the data folder to SYSTEM and the administrators.
//
// The folder holds the profile registry and the admin token. ProgramData is
// readable by every signed in user by default, and this machine has several of
// them, so inheritance is switched off and the list is written explicitly.
procedure ProtectDataDir;
var
  ResultCode: Integer;
  Target: String;
begin
  Target := ExpandConstant('{#DataDir}');
  if not RunAndWait(ExpandConstant('{sys}\icacls.exe'),
    '"' + Target + '" /inheritance:r' +
    ' /grant:r "*S-1-5-18":(OI)(CI)F' +
    ' /grant:r "*S-1-5-32-544":(OI)(CI)F',
    ResultCode) or (ResultCode <> 0) then
    RaiseException('Cannot secure the data folder. Setup cannot safely write the HTTPS private key.');
end;

// Writes the settings the service reads from its working folder.
procedure WriteEnvFile;
var
  Lines: TArrayOfString;
  Port: String;
begin
  Port := ChosenPort;

  SetArrayLength(Lines, 16);
  Lines[0]  := '# Written by the Tally MCP Server installer. Edit, then restart the service.';
  Lines[1]  := '';
  Lines[2]  := '# One profile per Tally user, each under /u/<id>/mcp.';
  Lines[3]  := 'MULTI_USER=1';
  Lines[4]  := '';
  Lines[5]  := '# Reachable from this machine only.';
  Lines[6]  := 'BIND_HOST=127.0.0.1';
  Lines[7]  := 'PORT=' + Port;
  Lines[8]  := 'MCP_DOMAIN=https://localhost:' + Port;
  Lines[9]  := '';
  Lines[10] := '# Profile registry and admin token.';
  Lines[11] := 'TALLY_MCP_DATA_DIR=' + ExpandConstant('{#DataDir}');
  Lines[12] := '';
  Lines[13] := '# Local HTTPS certificate created and trusted by the installer.';
  Lines[14] := 'TLS_PFX_PATH=' + ExpandConstant('{#DataDir}\localhost.pfx');
  Lines[15] := 'TLS_PFX_PASSWORD={#PfxPassword}';

  SaveStringsToFile(ExpandConstant('{app}\app\.env'), Lines, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssInstall then
  begin
    // an upgrade must not try to write over a running service
    RemoveService;
    Exit;
  end;

  if CurStep <> ssPostInstall then
    Exit;

  ProtectDataDir;
  WriteEnvFile;

  if not RunAndWait(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{app}\service\install-local-certificate.ps1') + '" -PfxPath "' +
      ExpandConstant('{#DataDir}\localhost.pfx') + '" -Password "{#PfxPassword}"', ResultCode)
      or (ResultCode <> 0) then
  begin
    RaiseException('The localhost HTTPS certificate could not be prepared (exit code ' +
      IntToStr(ResultCode) + '). The service was not installed. See ' +
      ExpandConstant('{#DataDir}\localhost.certificate.log') +
      '. If no log exists, verify that service\install-local-certificate.ps1 is installed.');
  end;

  if not RunAndWait(ServiceExe, 'install', ResultCode) or (ResultCode <> 0) then
  begin
    MsgBox('The service could not be registered. Check the log in ' +
           ExpandConstant('{#DataDir}\logs') + '.', mbError, MB_OK);
    Exit;
  end;

  if not RunAndWait(ServiceExe, 'start', ResultCode) or (ResultCode <> 0) then
    MsgBox('The service was registered but did not start. Open services.msc and start ' +
           '"Tally MCP Server", then check the log in ' +
           ExpandConstant('{#DataDir}\logs') + '.', mbError, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    RemoveService;
    RunAndWait(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{app}\service\install-local-certificate.ps1') + '" -PfxPath "' +
      ExpandConstant('{#DataDir}\localhost.pfx') + '" -Password "{#PfxPassword}" -Remove', ResultCode);
  end;

  if CurUninstallStep = usPostUninstall then
    MsgBox('The profiles and the admin token were left in ' + ExpandConstant('{#DataDir}') + '.' + #13#10 +
           'Delete that folder by hand if this machine will not run the server again.',
           mbInformation, MB_OK);
end;
