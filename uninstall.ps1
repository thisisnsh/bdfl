$ErrorActionPreference = "Stop"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("bdfl-uninstall-" + [guid]::NewGuid())

try {
  New-Item -ItemType Directory -Path $TempRoot | Out-Null
  $Installer = Join-Path $TempRoot "install.ps1"
  Invoke-WebRequest "https://github.com/thisisnsh/bdfl/releases/latest/download/install.ps1" -OutFile $Installer
  & $Installer --uninstall @args
  exit $LASTEXITCODE
}
finally {
  if (Test-Path $TempRoot) { Remove-Item -Recurse -Force $TempRoot }
}
