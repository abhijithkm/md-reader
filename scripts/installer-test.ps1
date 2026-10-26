<#
.SYNOPSIS
  Installs, upgrades and uninstalls MD Reader for real, and checks what Windows is left with.

.DESCRIPTION
  Meant for CI runners (the release workflow runs it). It changes the current user's file
  associations, Start menu and Apps & features list, so it refuses to run anywhere else unless
  -AllowLocal is given.

  Phase Install
    Installs -Installer. When -PreviousInstaller is given, that older installer goes in first,
    so the run upgrades over a real earlier installation. Then checks the installed files,
    shortcuts, the Apps & features entry and the file type registration (.md and .markdown,
    the "Open with" entries and the Default apps capabilities). Then installs once more the way
    the app's own updater does, running the installer from the updater's folder with --updated
    and /S, and checks that this leaves that folder alone. Writes the path of the installed
    executable to $env:GITHUB_OUTPUT as "exe", so later steps can run it.

  Phase Uninstall
    Runs the installed uninstaller and checks that the program, the shortcuts and every
    registry entry are gone, while the user's data folder is kept.

  Exits with 1 when any check fails.

.EXAMPLE
  ./scripts/installer-test.ps1 -Phase Install -Installer release/MDReader-Setup-1.0.0.exe `
    -PreviousInstaller release/previous/MDReader-Setup-0.0.1.exe
  ./scripts/installer-test.ps1 -Phase Uninstall
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Install', 'Uninstall')]
  [string]$Phase,

  [string]$Installer,

  [string]$PreviousInstaller,

  [switch]$AllowLocal
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (($env:CI -ne 'true') -and (-not $AllowLocal)) {
  Write-Host 'Refusing to run: this script installs MD Reader and changes the current user file associations.'
  Write-Host 'It is meant for CI runners. Pass -AllowLocal to run it on this machine anyway.'
  exit 2
}

# A silent install does not start the app, but if anything here ever does, it must not look for
# updates on the internet: an installation test must not depend on that. The setting is undone at
# the end, so that it does not stay behind in the session that ran this.
$previousUpdates = $env:MDREADER_UPDATES
$env:MDREADER_UPDATES = 'off'

$ProductName = 'MD Reader'
$ExecutableName = 'MDReader.exe'
$UninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$Classes = 'HKCU:\Software\Classes'
# Where build/installer.nsh registers MD Reader for Settings > Default apps. The names carry the
# publisher's name so that uninstalling cannot remove another program's entries.
$PublisherKey = 'HKCU:\Software\AbhijithKM'
$CapabilitiesKey = "$PublisherKey\MDReader\Capabilities"
$RegisteredName = 'AbhijithKM.MDReader'
# electron-builder puts a copy of the installer here, so that an update downloads only what changed.
# It stays while the program is installed and the uninstaller removes the folder.
$UpdaterFolder = Join-Path $env:LOCALAPPDATA 'md-reader-updater'
$StoredInstaller = Join-Path $UpdaterFolder 'installer.exe'
$Failures = New-Object System.Collections.Generic.List[string]

function Assert-That {
  param([bool]$Condition, [string]$Message)
  if ($Condition) {
    Write-Host "PASS  $Message"
  } else {
    Write-Host "FAIL  $Message"
    $Failures.Add($Message)
  }
}

function Get-DefaultValue([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return (Get-Item -LiteralPath $Path).GetValue('')
}

function Get-NamedValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return (Get-Item -LiteralPath $Path).GetValue($Name)
}

function Test-ValueName([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  return ((Get-Item -LiteralPath $Path).GetValueNames() -contains $Name)
}

# Emits the Apps & features entries called "MD Reader", and nothing when there are none.
# Call it as @(Get-UninstallEntry).
function Get-UninstallEntry {
  if (-not (Test-Path -LiteralPath $UninstallRoot)) { return }
  Get-ChildItem -LiteralPath $UninstallRoot |
    ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |
    Where-Object { $_.PSObject.Properties['DisplayName'] -and ($_.DisplayName -eq $ProductName) }
}

# The program that removes MD Reader, as named by the Apps & features entry. Its name comes from
# electron-builder, so read it instead of assuming it.
function Get-UninstallerPath($Entry) {
  if (([string]$Entry.UninstallString) -match '^"([^"]+)"') { return $Matches[1] }
  throw "Unexpected uninstall command: $($Entry.UninstallString)"
}

function Get-InstallDirectory($Entry) {
  return (Split-Path -Parent (Get-UninstallerPath $Entry))
}

function Get-InstallerVersion([string]$Path) {
  $name = Split-Path -Leaf $Path
  if ($name -notmatch '^MDReader-Setup-(?<version>.+)\.exe$') {
    throw "Unexpected installer file name: $name"
  }
  return $Matches['version']
}

function Stop-App {
  Get-Process -Name 'MDReader' -ErrorAction SilentlyContinue | Stop-Process -Force
}

function Wait-Until([scriptblock]$Condition, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) { return $true }
    Start-Sleep -Seconds 2
  }
  return [bool](& $Condition)
}

function Invoke-Installer([string]$Path, [string[]]$Arguments = @('/S')) {
  $name = Split-Path -Leaf $Path
  Write-Host "--- Running $name $($Arguments -join ' ')"
  $process = Start-Process -FilePath (Resolve-Path -LiteralPath $Path).Path -ArgumentList $Arguments -PassThru
  if (-not $process.WaitForExit(300000)) {
    $process.Kill()
    throw "$name did not finish within five minutes."
  }
  if ($process.ExitCode -ne 0) { throw "$name exited with code $($process.ExitCode)." }
  # The installer may start the app when it finishes; the checks below do not need it running.
  Start-Sleep -Seconds 2
  Stop-App
}

function Test-Installation([string]$Version) {
  Write-Host "--- Checking the installation of version $Version"
  $entries = @(Get-UninstallEntry)
  Assert-That ($entries.Count -eq 1) "exactly one $ProductName entry in Apps & features (found $($entries.Count))"
  if ($entries.Count -eq 0) { return $null }
  $entry = $entries[0]
  Assert-That ($entry.DisplayVersion -eq $Version) "Apps & features lists version $Version (found $($entry.DisplayVersion))"

  $installDir = Get-InstallDirectory $entry
  Assert-That $installDir.StartsWith($env:LOCALAPPDATA, [StringComparison]::OrdinalIgnoreCase) `
    "it is installed per user, under $env:LOCALAPPDATA (found $installDir)"

  $exe = Join-Path $installDir $ExecutableName
  Assert-That (Test-Path -LiteralPath $exe) "$ExecutableName is in the install folder"
  if (Test-Path -LiteralPath $exe) {
    $fileVersion = (Get-Item -LiteralPath $exe).VersionInfo.FileVersion
    $numeric = $Version.Split('-')[0]
    Assert-That ([string]$fileVersion).StartsWith($numeric) "$ExecutableName reports version $numeric (found $fileVersion)"
  }
  $uninstaller = Get-UninstallerPath $entry
  Assert-That (Test-Path -LiteralPath $uninstaller) "the uninstaller named in Apps & features exists ($uninstaller)"
  Assert-That (Test-Path -LiteralPath (Join-Path $installDir 'resources\app.asar')) 'the application archive is in the install folder'
  Assert-That (Test-Path -LiteralPath $StoredInstaller) `
    "the copy of the installer that updates compare with is kept ($StoredInstaller)"

  $shell = New-Object -ComObject WScript.Shell
  $shortcuts = @(
    @{ Place = 'Start menu'; Path = (Join-Path ([Environment]::GetFolderPath('Programs')) "$ProductName.lnk") },
    @{ Place = 'Desktop'; Path = (Join-Path ([Environment]::GetFolderPath('Desktop')) "$ProductName.lnk") }
  )
  foreach ($shortcut in $shortcuts) {
    $exists = Test-Path -LiteralPath $shortcut.Path
    Assert-That $exists "the $($shortcut.Place) shortcut exists"
    if ($exists) {
      $target = $shell.CreateShortcut($shortcut.Path).TargetPath
      Assert-That ($target -eq $exe) "the $($shortcut.Place) shortcut starts $exe (found $target)"
    }
  }

  # build/installer.nsh writes the open commands with the program path in quotes.
  $expectedCommand = '"' + $exe + '" "%1"'
  foreach ($extension in 'md', 'markdown') {
    $progId = "MDReader.$extension"
    Assert-That ((Get-DefaultValue "$Classes\.$extension") -eq $progId) ".$extension is registered to $progId"
    Assert-That ((Get-DefaultValue "$Classes\$progId") -eq 'Markdown Document') "$progId is described as Markdown Document"

    $command = Get-DefaultValue "$Classes\$progId\shell\open\command"
    Assert-That (($command -is [string]) -and ($command -eq $expectedCommand)) `
      "$progId opens files with $expectedCommand (found $command)"

    $icon = Get-DefaultValue "$Classes\$progId\DefaultIcon"
    $iconFile = $null
    if (($icon -is [string]) -and ($icon -match '^\s*"?(?<path>[^",]+?)"?\s*(,\s*-?\d+)?\s*$')) { $iconFile = $Matches['path'] }
    Assert-That (($null -ne $iconFile) -and (Test-Path -LiteralPath $iconFile)) "$progId has an icon that exists (found $icon)"
  }

  $application = "$Classes\Applications\$ExecutableName"
  $openCommand = Get-DefaultValue "$application\shell\open\command"
  Assert-That (($openCommand -is [string]) -and ($openCommand -eq $expectedCommand)) `
    "the Open with list starts the installed program with $expectedCommand (found $openCommand)"
  Assert-That (Test-ValueName "$application\SupportedTypes" '.md') '"Open with" offers it for .md'
  Assert-That (Test-ValueName "$application\SupportedTypes" '.markdown') '"Open with" offers it for .markdown'

  $capabilities = $CapabilitiesKey
  Assert-That ((Get-NamedValue 'HKCU:\Software\RegisteredApplications' $RegisteredName) -eq $CapabilitiesKey.Substring('HKCU:\'.Length)) `
    'Settings > Default apps can list MD Reader (RegisteredApplications)'
  Assert-That ((Get-NamedValue $capabilities 'ApplicationName') -eq $ProductName) 'the capabilities carry the application name'
  Assert-That ((Get-NamedValue "$capabilities\FileAssociations" '.md') -eq 'MDReader.md') 'the capabilities offer .md'
  Assert-That ((Get-NamedValue "$capabilities\FileAssociations" '.markdown') -eq 'MDReader.markdown') 'the capabilities offer .markdown'

  return $installDir
}

function Invoke-InstallPhase {
  if ((-not $Installer) -or (-not (Test-Path -LiteralPath $Installer))) {
    throw "-Installer must name an existing file (got '$Installer')."
  }
  if (@(Get-UninstallEntry).Count -gt 0) {
    throw "$ProductName is already installed on this machine; refusing to change it."
  }

  # A fresh profile on a runner may lack the folders the shortcuts go in; the installer does not
  # create them, and a real user's profile always has them.
  'Desktop', 'Programs' | ForEach-Object {
    New-Item -ItemType Directory -Force -Path ([Environment]::GetFolderPath($_)) | Out-Null
  }

  if ($PreviousInstaller) {
    if (-not (Test-Path -LiteralPath $PreviousInstaller)) { throw "-PreviousInstaller does not exist: $PreviousInstaller" }
    Invoke-Installer $PreviousInstaller
    [void](Test-Installation (Get-InstallerVersion $PreviousInstaller))
    Write-Host '--- The older version is in place; upgrading over it'
  }

  $version = Get-InstallerVersion $Installer
  Invoke-Installer $Installer
  $installDir = Test-Installation $version
  if (-not $installDir) { return }

  # An installed copy updates itself by running the new installer from the folder where it saved it,
  # with --updated and /S. The old version is uninstalled first, and that uninstall must leave the
  # folder alone: the installer that is running sits in it. Nothing else here runs an installer from
  # there, so this is the one place the guard in build/installer.nsh is put to the test.
  Write-Host '--- Installing again the way an update does, from the updater folder'
  $pending = Join-Path $UpdaterFolder 'pending'
  New-Item -ItemType Directory -Force -Path $pending | Out-Null
  $updateInstaller = Join-Path $pending (Split-Path -Leaf $Installer)
  Copy-Item -LiteralPath $Installer -Destination $updateInstaller -Force
  $updateNote = Join-Path $pending 'update-info.json'
  Set-Content -LiteralPath $updateNote -Value '{}'
  Invoke-Installer $updateInstaller @('--updated', '/S')
  $installDir = Test-Installation $version
  Assert-That (Test-Path -LiteralPath $updateNote) 'an update that runs from the updater folder leaves what the updater keeps there'
  Assert-That (Test-Path -LiteralPath $updateInstaller) 'the installer that did the update is still where the updater put it'
  if (-not $installDir) { return }

  $exe = Join-Path $installDir $ExecutableName
  Write-Host "Installed to $installDir"
  if ($env:GITHUB_OUTPUT) {
    "exe=$exe" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
  }
}

function Invoke-UninstallPhase {
  $entries = @(Get-UninstallEntry)
  if ($entries.Count -ne 1) { throw "Expected one installed copy of $ProductName, found $($entries.Count)." }
  $uninstaller = Get-UninstallerPath $entries[0]
  $installDir = Get-InstallDirectory $entries[0]
  # The registry holds the command Windows runs, such as: "<folder>\Uninstall ....exe" /currentuser
  $uninstallString = [string]$entries[0].UninstallString
  $arguments = @($uninstallString.Substring($uninstallString.IndexOf('"', 1) + 1).Split(' ', [StringSplitOptions]::RemoveEmptyEntries)) + '/S'

  # User data must survive an uninstall (deleteAppDataOnUninstall is false).
  $dataDirectory = Join-Path $env:APPDATA $ProductName
  $marker = Join-Path $dataDirectory 'uninstall-test-marker.txt'
  New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null
  Set-Content -LiteralPath $marker -Value 'kept'

  Stop-App
  Write-Host "--- Running the uninstaller: $uninstaller $($arguments -join ' ')"
  $process = Start-Process -FilePath $uninstaller -ArgumentList $arguments -PassThru
  [void]$process.WaitForExit(300000)

  # The uninstaller copies itself to a temporary folder and exits before the work is done.
  $exe = Join-Path $installDir $ExecutableName
  $gone = Wait-Until { (-not (Test-Path -LiteralPath $exe)) -and (@(Get-UninstallEntry).Count -eq 0) } 120
  Assert-That $gone 'the uninstaller removed the program and its Apps & features entry'

  Write-Host '--- Checking nothing is left behind'
  $leftovers = if (Test-Path -LiteralPath $installDir) { (Get-ChildItem -LiteralPath $installDir -Force -Recurse | Select-Object -First 5 | ForEach-Object { $_.Name }) -join ', ' } else { '' }
  Assert-That (-not (Test-Path -LiteralPath $installDir)) "the install folder is gone ($installDir $leftovers)"
  Assert-That (-not (Test-Path -LiteralPath $UpdaterFolder)) "the updater folder is gone ($UpdaterFolder)"
  foreach ($place in @(
      @{ Name = 'Start menu'; Path = (Join-Path ([Environment]::GetFolderPath('Programs')) "$ProductName.lnk") },
      @{ Name = 'Desktop'; Path = (Join-Path ([Environment]::GetFolderPath('Desktop')) "$ProductName.lnk") })) {
    Assert-That (-not (Test-Path -LiteralPath $place.Path)) "the $($place.Name) shortcut is gone"
  }
  foreach ($extension in 'md', 'markdown') {
    $progId = "MDReader.$extension"
    Assert-That (-not (Test-Path -LiteralPath "$Classes\$progId")) "$progId is unregistered"
    Assert-That ((Get-DefaultValue "$Classes\.$extension") -ne $progId) ".$extension no longer points at MD Reader"
  }
  Assert-That (-not (Test-Path -LiteralPath "$Classes\Applications\$ExecutableName")) 'the "Open with" entry is gone'
  Assert-That (-not (Test-Path -LiteralPath $CapabilitiesKey)) 'the Default apps capabilities are gone'
  Assert-That (-not (Test-Path -LiteralPath $PublisherKey)) 'the publisher key is gone, as nothing else was in it'
  Assert-That (-not (Test-ValueName 'HKCU:\Software\RegisteredApplications' $RegisteredName)) 'MD Reader is no longer a registered application'
  Assert-That (Test-Path -LiteralPath $marker) 'the user data folder was kept'

  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  if ((Test-Path -LiteralPath $dataDirectory) -and (-not (Get-ChildItem -LiteralPath $dataDirectory -Force))) {
    Remove-Item -LiteralPath $dataDirectory -Force
  }
  if (Test-Path -LiteralPath $installDir) {
    Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

try {
  if ($Phase -eq 'Install') { Invoke-InstallPhase } else { Invoke-UninstallPhase }
} catch {
  Write-Host "ERROR $($_.Exception.Message)"
  Write-Host $_.ScriptStackTrace
  $Failures.Add($_.Exception.Message)
} finally {
  if ($null -eq $previousUpdates) {
    Remove-Item -LiteralPath Env:MDREADER_UPDATES -ErrorAction SilentlyContinue
  } else {
    $env:MDREADER_UPDATES = $previousUpdates
  }
}

if ($Failures.Count -gt 0) {
  Write-Host ''
  Write-Host "$($Failures.Count) check(s) failed:"
  $Failures | ForEach-Object { Write-Host "  - $_" }
  exit 1
}
Write-Host ''
Write-Host "All $Phase checks passed."
