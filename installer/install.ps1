$ErrorActionPreference = "Stop"

$appName = "LexiCore"
$version = "0.1.0"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\LexiCore"
$packagePath = Join-Path $PSScriptRoot "LexiCore.zip"
$extractDir = Join-Path ([System.IO.Path]::GetTempPath()) ("LexiCoreInstall-" + [System.Guid]::NewGuid().ToString("N"))
$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\LexiCore"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "LexiCore.lnk"
$startShortcut = Join-Path $startMenuDir "LexiCore.lnk"
$uninstallShortcut = Join-Path $startMenuDir "Uninstall LexiCore.lnk"
$exePath = Join-Path $installDir "LexiCore.exe"
$uninstallScriptPath = Join-Path $installDir "uninstall.ps1"

if (!(Test-Path $packagePath)) {
  throw "LexiCore.zip was not found next to the installer script."
}

Get-Process -Name "LexiCore" -ErrorAction SilentlyContinue | Stop-Process -Force

if (Test-Path $extractDir) {
  Remove-Item -LiteralPath $extractDir -Recurse -Force
}
New-Item -ItemType Directory -Path $extractDir | Out-Null

Expand-Archive -LiteralPath $packagePath -DestinationPath $extractDir -Force

if (Test-Path $installDir) {
  Remove-Item -LiteralPath $installDir -Recurse -Force
}
New-Item -ItemType Directory -Path $installDir | Out-Null

Copy-Item -Path (Join-Path $extractDir "*") -Destination $installDir -Recurse -Force

$uninstallScript = @'
$ErrorActionPreference = "Stop"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\LexiCore"
$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\LexiCore"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "LexiCore.lnk"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LexiCore"

Get-Process -Name "LexiCore" -ErrorAction SilentlyContinue | Stop-Process -Force
if (Test-Path $desktopShortcut) { Remove-Item -LiteralPath $desktopShortcut -Force }
if (Test-Path $startMenuDir) { Remove-Item -LiteralPath $startMenuDir -Recurse -Force }
if (Test-Path $uninstallKey) { Remove-Item -LiteralPath $uninstallKey -Recurse -Force }
if (Test-Path $installDir) { Remove-Item -LiteralPath $installDir -Recurse -Force }
'@
Set-Content -LiteralPath $uninstallScriptPath -Value $uninstallScript -Encoding UTF8

New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null

$shell = New-Object -ComObject WScript.Shell

$shortcut = $shell.CreateShortcut($desktopShortcut)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $installDir
$shortcut.IconLocation = $exePath
$shortcut.Save()

$shortcut = $shell.CreateShortcut($startShortcut)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $installDir
$shortcut.IconLocation = $exePath
$shortcut.Save()

$shortcut = $shell.CreateShortcut($uninstallShortcut)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$uninstallScriptPath`""
$shortcut.WorkingDirectory = $installDir
$shortcut.Save()

$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LexiCore"
New-Item -Path $uninstallKey -Force | Out-Null
Set-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value $appName
Set-ItemProperty -Path $uninstallKey -Name "DisplayVersion" -Value $version
Set-ItemProperty -Path $uninstallKey -Name "Publisher" -Value "LexiCore"
Set-ItemProperty -Path $uninstallKey -Name "InstallLocation" -Value $installDir
Set-ItemProperty -Path $uninstallKey -Name "DisplayIcon" -Value $exePath
Set-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$uninstallScriptPath`""

Remove-Item -LiteralPath $extractDir -Recurse -Force

Start-Process -FilePath $exePath -WorkingDirectory $installDir
