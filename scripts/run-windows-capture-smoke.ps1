param(
  [Parameter(Mandatory = $true)]
  [string]$AppPath
)

$ErrorActionPreference = 'Stop'
foreach ($name in @(
  'DAYLENS_SMOKE_REPORT_PATH',
  'DAYLENS_SMOKE_WINDOW_STATE_PATH',
  'DAYLENS_SMOKE_EXPECT_FOREGROUND_TITLE',
  'DAYLENS_SMOKE_EXPECT_FULLSCREEN_TITLE'
)) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "$name is required"
  }
}

$probeDir = Join-Path $env:RUNNER_TEMP 'daylens-runtime-capture-probe'
if (Test-Path $probeDir) { Remove-Item -Recurse -Force $probeDir }
New-Item -ItemType Directory -Path $probeDir | Out-Null
$baseProbe = Join-Path $probeDir 'RuntimeCaptureProbe.exe'
$foregroundProbe = Join-Path $probeDir 'ForegroundCaptureProbe.exe'
$fullscreenProbe = Join-Path $probeDir 'FullscreenCaptureProbe.exe'

dotnet publish scripts/runtime-smoke-window.csproj --configuration Release --output $probeDir
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $baseProbe)) {
  throw 'Failed to build the Windows runtime capture probe.'
}
Copy-Item $baseProbe $foregroundProbe
Copy-Item $baseProbe $fullscreenProbe

$app = Start-Process -FilePath $AppPath -PassThru
try {
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    $app.Refresh()
  } while ($app.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline -and -not $app.HasExited)
  if ($app.HasExited) { throw "Daylens exited before the capture probe with code $($app.ExitCode)" }
  if ($app.MainWindowHandle -eq 0) { throw 'Daylens did not create a visible window.' }

  $foreground = Start-Process -FilePath $foregroundProbe -ArgumentList @(
    "`"$env:DAYLENS_SMOKE_EXPECT_FOREGROUND_TITLE`"",
    'foreground',
    '30',
    "`"$env:DAYLENS_SMOKE_WINDOW_STATE_PATH`""
  ) -PassThru -Wait
  if ($foreground.ExitCode -ne 0) { throw "Foreground capture probe exited with code $($foreground.ExitCode)" }

  $fullscreen = Start-Process -FilePath $fullscreenProbe -ArgumentList @(
    "`"$env:DAYLENS_SMOKE_EXPECT_FULLSCREEN_TITLE`"",
    'fullscreen',
    '30',
    "`"$env:DAYLENS_SMOKE_WINDOW_STATE_PATH`""
  ) -PassThru -Wait
  if ($fullscreen.ExitCode -ne 0) { throw "Fullscreen capture probe exited with code $($fullscreen.ExitCode)" }

  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SmokeForegroundWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
  $app.Refresh()
  [SmokeForegroundWindow]::SetForegroundWindow($app.MainWindowHandle) | Out-Null

  if (-not $app.WaitForExit(30000)) {
    throw 'Daylens did not finish runtime smoke validation after the capture probes completed.'
  }
  if ($app.ExitCode -ne 0) { throw "Daylens smoke run exited with code $($app.ExitCode)" }
} finally {
  if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
}
