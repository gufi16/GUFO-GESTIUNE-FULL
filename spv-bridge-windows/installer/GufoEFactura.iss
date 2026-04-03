[Setup]
AppId={{0D49A7F4-84AA-49E6-9D6B-774F6C78EFA1}
AppName=Gufo e-Factura
AppVersion=1.0.0
AppPublisher=Gufo
DefaultDirName={autopf}\Gufo e-Factura
DefaultGroupName=Gufo e-Factura
DisableProgramGroupPage=yes
OutputDir=..\release\installer
OutputBaseFilename=Gufo-eFactura-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\branding\gufo-efactura-setup.ico
SetupIconFile=..\branding\gufo-efactura-setup.ico

[Files]
Source: "..\release\Gufo e-Factura\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Gufo e-Factura"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\start-agent.ps1"""; IconFilename: "{app}\branding\gufo-efactura-setup.ico"
Name: "{group}\Dezinstaleaza Gufo e-Factura"; Filename: "{app}\uninstall-agent.ps1"; IconFilename: "{app}\branding\gufo-efactura-setup.ico"

[Run]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\install-agent.ps1"""; Flags: postinstall waituntilterminated
Filename: "http://127.0.0.1:48521/"; Flags: shellexec postinstall skipifsilent
