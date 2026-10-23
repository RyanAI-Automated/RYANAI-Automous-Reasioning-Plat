; File path: ./installer/setup.iss

[Setup]
AppName=RyanAI Sovereign Reasoning Platform
AppVersion=2.4.0
AppPublisher=Ntsiyeni Ganyane
DefaultDirName={pf}\RyanAI
DefaultGroupName=RyanAI Sovereign
OutputDir=..\release
OutputBaseFilename=RyanAI_Setup_v2.4.0
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin

[Files]
Source: "..\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs
Source: "..\server.ts"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\RyanAI Engine"; Filename: "{app}\dist\index.html"
Name: "{commondesktop}\RyanAI Sovereign"; Filename: "{app}\dist\index.html"