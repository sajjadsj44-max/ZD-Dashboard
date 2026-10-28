<# AutoCAD helper for PDF Takeoff - set up once on a computer with AutoCAD and Node.js (double-click cad-bridge-setup.cmd).
   Copies cad-bridge.js to %LOCALAPPDATA%\ZD\cad-bridge (so it does not depend on which branch this folder is on), starts it
   with Windows (a shortcut in the Startup folder), registers the zd-cad: link the takeoff opens to start it when it is not
   running, and starts it now. No administrator rights are needed. Run it again after cad-bridge.js changes: the copy is
   replaced and the helper restarted.
     cad-bridge-setup.cmd -Remove     takes all of it away again (and stops the helper) #>
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'ZD\cad-bridge'
$vbs = Join-Path $dir 'start.vbs'
$key = 'HKCU:\Software\Classes\zd-cad'
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'ZD AutoCAD helper.lnk'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$port = 11436

function Stop-Helper {   # every running copy of the helper (from this folder or the repo)
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*cad-bridge.js*' } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction Stop } catch {} }
}
function Get-Helper {   # what the helper says about itself, or $null when it does not answer
  try { $r = Invoke-RestMethod "http://127.0.0.1:$port/" -TimeoutSec 2; if ($r.app -eq 'zd-cad-bridge') { $r } } catch { $null }
}

if ($Remove) {
  Stop-Helper
  if (Test-Path $key) { Remove-Item $key -Recurse -Force }
  if (Test-Path $lnk) { Remove-Item $lnk -Force }
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  'The AutoCAD helper is removed from this computer: it no longer starts with Windows or from the takeoff.'
  return
}

$node = (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
if (-not (Test-Path $node)) { throw 'Node.js was not found - install it from https://nodejs.org (LTS), then run this again.' }

New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'cad-bridge.js') (Join-Path $dir 'cad-bridge.js') -Force
# the starter: node with no window, what it prints kept in cad-bridge.log (a second copy finds the port taken and exits at once)
$start = @"
' AutoCAD helper for PDF Takeoff: starts cad-bridge.js (next to this file) with no window. Written by tools\cad-bridge-setup.ps1.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$dir"
sh.Run """$node"" ""$dir\cad-bridge.js"" --log ""$dir\cad-bridge.log""", 0, False
"@
Set-Content -Path $vbs -Value $start -Encoding Unicode

# the zd-cad: link: the takeoff opens zd-cad:start when no helper answers
New-Item -Path "$key\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $key -Name '(default)' -Value 'URL:ZD AutoCAD helper'
Set-ItemProperty -Path $key -Name 'URL Protocol' -Value ''
Set-ItemProperty -Path "$key\shell\open\command" -Name '(default)' -Value ('"{0}" "{1}" "%1"' -f $wscript, $vbs)

# with Windows
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = $wscript; $s.Arguments = '"' + $vbs + '"'; $s.WorkingDirectory = $dir; $s.Description = 'AutoCAD helper for PDF Takeoff'
$s.Save()

# and now: an older copy already running is replaced
Stop-Helper
Start-Process $wscript -ArgumentList ('"' + $vbs + '"')
$h = $null
for ($i = 0; $i -lt 30 -and -not $h; $i++) { Start-Sleep -Milliseconds 500; $h = Get-Helper }
if (-not $h) { throw "The helper did not start - see $dir\cad-bridge.log" }
''
'The AutoCAD helper is set up on this computer.'
'  Running now, using: ' + $(if ($h.autocad.Count) { $h.autocad -join ', ' } else { 'AutoCAD NOT FOUND - install AutoCAD' })
'  Starts with Windows, and the takeoff starts it itself if it was closed (the browser asks once: tick "Always allow").'
"  Its log: $dir\cad-bridge.log"
'  To take it away again: cad-bridge-setup.cmd -Remove'
