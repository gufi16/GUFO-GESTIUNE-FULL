[Setup]
AppId={{0D49A7F4-84AA-49E6-9D6B-774F6C78EFA1}
AppName=Gufo e-Factura
AppVersion=1.0.0
AppPublisher=Gufo
DefaultDirName={autopf}\Gufo e-Factura
DefaultGroupName=Gufo e-Factura
DisableProgramGroupPage=yes
Compression=lzma
SolidCompression=yes
WizardStyle=modern
OutputDir={#GetEnv('DesktopInstallerOutputDir')}
OutputBaseFilename={#GetEnv('DesktopInstallerBaseName')}

#define SetupIcon GetEnv("DesktopSetupIcon")
#if SetupIcon != ""
SetupIconFile={#SetupIcon}
UninstallDisplayIcon={app}\Gufo e-Factura.exe
#endif

[Files]
Source: "{#GetEnv('DesktopReleaseSource')}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Gufo e-Factura"; Filename: "{app}\Gufo e-Factura.exe"
Name: "{autodesktop}\Gufo e-Factura"; Filename: "{app}\Gufo e-Factura.exe"

[Run]
Filename: "{app}\Gufo e-Factura.exe"; Description: "Porneste Gufo e-Factura"; Flags: nowait postinstall skipifsilent
