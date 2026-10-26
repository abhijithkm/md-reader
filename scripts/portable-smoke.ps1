<#
.SYNOPSIS
  Starts the portable executable with a Markdown file and checks that it shows the document.

.DESCRIPTION
  Used by the release workflow, and safe to run on a development machine: it installs nothing and
  changes no file associations or registry entries. The app gets its own empty profile folder in a
  temporary directory, which is removed afterwards.

  It looks at the app through its remote debugging port, the same way the end-to-end tests do, and
  waits for a window whose title names the document.

.EXAMPLE
  ./scripts/portable-smoke.ps1 -Portable release/MDReader-Portable-1.0.0.exe
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Portable
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $Portable)) { throw "The portable executable does not exist: $Portable" }
$executable = (Resolve-Path -LiteralPath $Portable).Path

$work = Join-Path ([IO.Path]::GetTempPath()) ('mdreader-portable-' + [guid]::NewGuid().ToString('N'))
$profileDirectory = Join-Path $work 'profile'
# A folder name with a space, as in a real user's documents.
$documents = Join-Path $work 'My Docs'
New-Item -ItemType Directory -Force -Path $profileDirectory, $documents | Out-Null
$document = Join-Path $documents 'Portable check.md'
Set-Content -LiteralPath $document -Value "# The portable build works`n`nThis document was opened from the command line.`n" -Encoding utf8

# Ask the operating system for a free port, then release it for the app to use.
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()

# The app looks for updates on the internet unless told not to, and this check must not need that.
# The setting is undone at the end, so that it does not stay behind in the session that ran this.
$previousUpdates = $env:MDREADER_UPDATES
$env:MDREADER_UPDATES = 'off'

# Start-Process joins the arguments with spaces without quoting them, so quote the paths here.
$process = Start-Process -FilePath $executable -PassThru -ArgumentList @(
  ('"{0}"' -f $document),
  "--remote-debugging-port=$port",
  ('--user-data-dir="{0}"' -f $profileDirectory)
)

$title = $null
try {
  $started = Get-Date
  $deadline = $started.AddSeconds(90)
  while ((-not $title) -and ((Get-Date) -lt $deadline)) {
    try {
      $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 2
      $window = @($targets | Where-Object { ($_.type -eq 'page') -and ($_.title -like '*Portable check.md*') }) | Select-Object -First 1
      if ($window) { $title = $window.title }
    } catch {
      # The app is still starting.
    }
    if (-not $title) { Start-Sleep -Milliseconds 500 }
  }
  if (-not $title) { throw 'The portable executable did not show the document within 90 seconds.' }

  $seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  Write-Host "PASS  the portable executable opened the document in $seconds s (window title: $title)"
} finally {
  if ($null -eq $previousUpdates) {
    Remove-Item -LiteralPath Env:MDREADER_UPDATES -ErrorAction SilentlyContinue
  } else {
    $env:MDREADER_UPDATES = $previousUpdates
  }
  # The portable executable starts the real app as a separate process. Stop the processes that
  # were given this run's profile folder, and no others: a developer may have their own MD Reader
  # open.
  Get-CimInstance -ClassName Win32_Process -Filter "Name = 'MDReader.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDirectory) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if (-not $process.HasExited) { $process.Kill() }
  Start-Sleep -Seconds 2
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
