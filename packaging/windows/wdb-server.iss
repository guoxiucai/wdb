#ifndef Payload
  #error Payload is required
#endif
#ifndef SignedCache
  #define SignedCache OutputDir + "\signed-uninstaller"
#endif
[Setup]
AppId={{CB6CE060-4707-4E8F-880A-64CBB085D781}
AppName=WDB Server
AppVersion={#ProductVersion}
AppPublisher={#Publisher}
DefaultDirName={autopf}\wdb
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19045
SetupMutex=Global\WdbServerSetup
OutputDir={#OutputDir}
OutputBaseFilename=wdb-server-{#ProductVersion}-windows-x64-{#RuntimeMode}-{#SigningMode}-setup
Compression=lzma2/fast
SolidCompression=yes
DiskSpanning=no
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\native\WdbServiceHost.exe
VersionInfoDescription=WDB Server {#RuntimeMode} ({#SigningMode})
#if SigningMode == "Manual"
SignedUninstaller=yes
SignedUninstallerDir={#SignedCache}
#else
SignedUninstaller=no
#endif
[Files]
Source: "{#Payload}\*"; DestDir: "{tmp}\wdb-payload"; Flags: dontcopy recursesubdirs
Source: "{#Payload}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[UninstallDelete]
Type: files; Name: "{app}\runtime-binding.json"
Type: files; Name: "{app}\installation-health.json"
[Code]
var
  AccountPage: TInputQueryWizardPage;
  TransactionStarted, TransactionFinished: Boolean;
  DesktopAccount, ExternalNode: String;

function Quoted(Value: String): String;
begin
  if (Pos('"', Value) > 0) or (Pos(#13, Value) > 0) or (Pos(#10, Value) > 0) then
    RaiseException('Invalid quote or newline in installer parameter.');
  Result := '"' + Value + '"';
end;

function ConsoleAccount(): String;
var Locator, Services, Systems, Item: Variant;
begin
  Result := '';
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Services := Locator.ConnectServer('', 'root\CIMV2');
    Systems := Services.ExecQuery('SELECT UserName FROM Win32_ComputerSystem');
    if Systems.Count > 0 then begin
      Item := Systems.ItemIndex(0);
      if not VarIsNull(Item.UserName) then Result := Item.UserName;
    end;
  except
    Log('No active console account available; require explicit desktop user.');
  end;
end;

procedure InitializeWizard;
begin
  DesktopAccount := ExpandConstant('{param:DESKTOPUSER|}');
  ExternalNode := ExpandConstant('{param:NODEPATH|}');
  AccountPage := CreateInputQueryPage(wpWelcome, 'WDB desktop account',
    'Choose the real interactive desktop user',
    'The desktop helper runs with this user''s limited permissions. Existing data and remembered clients are retained.');
  AccountPage.Add('Desktop account (DOMAIN\User):', False);
  if (DesktopAccount = '') and not WizardSilent then DesktopAccount := ConsoleAccount();
  AccountPage.Values[0] := DesktopAccount;
#if RuntimeMode == "external-node"
  AccountPage.Add('System Node.exe path (>=24.15.0 <25):', False);
  if ExternalNode = '' then ExternalNode := ExpandConstant('{autopf}\nodejs\node.exe');
  AccountPage.Values[1] := ExternalNode;
#endif
end;

function RunAction(Action: String): Boolean;
var Args, Script: String; Code: Integer;
begin
  Script := ExpandConstant('{tmp}\wdb-payload\scripts\installer-action.ps1');
  Args := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + Quoted(Script) +
    ' -Action ' + Action + ' -SourceDirectory ' + Quoted(ExpandConstant('{tmp}\wdb-payload')) +
    ' -InstallDirectory ' + Quoted(ExpandConstant('{app}')) +
    ' -DesktopUser ' + Quoted(DesktopAccount) + ' -RuntimeMode {#RuntimeMode}';
  if ExternalNode <> '' then Args := Args + ' -NodePath ' + Quoted(ExternalNode);
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Args, '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
  Log('WDB action ' + Action + ', exit ' + IntToStr(Code));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  DesktopAccount := AccountPage.Values[0];
#if RuntimeMode == "external-node"
  ExternalNode := AccountPage.Values[1];
#endif
  if DesktopAccount = '' then begin
    Result := 'Supply /DESKTOPUSER="DOMAIN\User" in silent mode, or select the actual desktop account.'; Exit;
  end;
  ExtractTemporaryFiles('{tmp}\wdb-payload\*');
  if not RunAction('Preflight') then begin
    Result := 'WDB preflight failed. The existing installation was not stopped. Check Windows/.NET requirements, protected Node path, disk space and ports. See C:\ProgramData\WdbInstaller\installer.log.'; Exit;
  end;
  if not RunAction('Begin') then begin
    Result := 'WDB could not prepare a recoverable upgrade. See the installer diagnostic log.'; Exit;
  end;
  TransactionStarted := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    if not RunAction('Commit') then begin
      RunAction('Rollback');
      RaiseException('WDB startup validation failed. Previous program restored; user data retained.');
    end;
  end;
  if CurStep = ssDone then begin
    if not RunAction('Finish') then RaiseException('WDB installation finalization failed.');
    TransactionFinished := True;
  end;
end;

procedure DeinitializeSetup;
begin
  if TransactionStarted and not TransactionFinished then RunAction('Rollback');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Code: Integer; Args: String; Started: Boolean;
begin
  if CurUninstallStep <> usUninstall then Exit;
  Args := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + Quoted(ExpandConstant('{app}\scripts\installer-action.ps1')) +
    ' -Action Uninstall -InstallDirectory ' + Quoted(ExpandConstant('{app}'));
  Code := -1;
  Started := ExecAndLogOutput(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Args, '', SW_HIDE, ewWaitUntilTerminated, Code, nil);
  Log('WDB action Uninstall, exit ' + IntToStr(Code));
  if not Started or (Code <> 0) then
    RaiseException('Could not stop/remove WDB service. Program files retained; retry as administrator.');
end;
