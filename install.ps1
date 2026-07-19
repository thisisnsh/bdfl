$ErrorActionPreference = "Stop"
$BaseUrl = if ($env:BDFL_VERSION) {
  "https://github.com/thisisnsh/bdfl/releases/download/v$($env:BDFL_VERSION)"
} else {
  "https://github.com/thisisnsh/bdfl/releases/latest/download"
}
$Archive = "bdfl.zip"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("bdfl-" + [guid]::NewGuid())

try {
  New-Item -ItemType Directory -Path $TempRoot | Out-Null
  Invoke-WebRequest "$BaseUrl/$Archive" -OutFile (Join-Path $TempRoot $Archive)
  Invoke-WebRequest "$BaseUrl/checksums.txt" -OutFile (Join-Path $TempRoot "checksums.txt")
  $ChecksumLine = Get-Content (Join-Path $TempRoot "checksums.txt") | Where-Object { $_ -match "\s+$([regex]::Escape($Archive))$" }
  if (-not $ChecksumLine) { throw "Missing checksum for $Archive" }
  $Expected = ($ChecksumLine -split "\s+")[0].ToLowerInvariant()
  $Actual = (Get-FileHash (Join-Path $TempRoot $Archive) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "Checksum verification failed" }
  $Source = Join-Path $TempRoot "source"
  Expand-Archive (Join-Path $TempRoot $Archive) -DestinationPath $Source
  & node (Join-Path $Source "bin/install.js") @args
  exit $LASTEXITCODE
}
finally {
  if (Test-Path $TempRoot) { Remove-Item -Recurse -Force $TempRoot }
}
