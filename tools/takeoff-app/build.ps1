# Builds the PDF Takeoff Windows app (see App.cs) with Windows' own C# compiler — no Visual Studio or .NET SDK needed.
#   powershell -ExecutionPolicy Bypass -File tools\takeoff-app\build.ps1
# Writes app\ZD-Takeoff.exe (the friends' link: a login per friend) and app\ZD-Takeoff-Pro.exe (the full app, password sa).
# The WebView2 libraries come from NuGet (Microsoft.Web.WebView2, pinned below) and go inside each .exe.
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot; $repo = Resolve-Path "$here\..\.."
$wv = "1.0.4314.35"
$tmp = Join-Path $env:TEMP "zd-takeoff-app-build"; New-Item -ItemType Directory -Force $tmp | Out-Null
$pkg = Join-Path $tmp "wv2-$wv"
if (-not (Test-Path "$pkg\lib\net462\Microsoft.Web.WebView2.Core.dll")) {
  Invoke-WebRequest -UseBasicParsing "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$wv/microsoft.web.webview2.$wv.nupkg" -OutFile "$tmp\wv2.zip"
  Expand-Archive -Force "$tmp\wv2.zip" $pkg
}
$core = "$pkg\lib\net462\Microsoft.Web.WebView2.Core.dll"; $wf = "$pkg\lib\net462\Microsoft.Web.WebView2.WinForms.dll"; $ld = "$pkg\runtimes\win-x64\native\WebView2Loader.dll"

# the icon: the takeoff's own, at 256 / 48 / 32 / 16 px, as PNGs in one .ico
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile("$repo\takeoff\icon-512.png"); $imgs = @()
foreach ($s in 256, 48, 32, 16) {
  $b = New-Object System.Drawing.Bitmap $s, $s; $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode = "HighQualityBicubic"; $g.DrawImage($src, 0, 0, $s, $s); $g.Dispose()
  $m = New-Object System.IO.MemoryStream; $b.Save($m, [System.Drawing.Imaging.ImageFormat]::Png); $imgs += , @($s, $m.ToArray()); $b.Dispose()
}
$src.Dispose()
$ico = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$imgs.Count); $off = 6 + 16 * $imgs.Count
foreach ($i in $imgs) { $s = $i[0]; $w.Write([byte]($s % 256)); $w.Write([byte]($s % 256)); $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$i[1].Length); $w.Write([uint32]$off); $off += $i[1].Length }
foreach ($i in $imgs) { $w.Write($i[1]) }
[System.IO.File]::WriteAllBytes("$tmp\app.ico", $ico.ToArray())

function Enc($s) { $b = [System.Text.Encoding]::UTF8.GetBytes($s); for ($i = 0; $i -lt $b.Length; $i++) { $b[$i] = $b[$i] -bxor 0x5A }; [Convert]::ToBase64String($b) }
$site = "https://sajjadsj44-max.github.io/ZD-Dashboard/"
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
New-Item -ItemType Directory -Force "$repo\app" | Out-Null
foreach ($v in @(@{name = "ZD Takeoff"; out = "ZD-Takeoff.exe"; home = "${site}takeoff/?team"; site = "${site}takeoff/"},
                 @{name = "ZD Takeoff Pro"; out = "ZD-Takeoff-Pro.exe"; home = "${site}takeoff/index.html"; site = $site})) {
  "static class Config { public const string Name = `"$($v.name)`"; public const string Home = `"$(Enc $v.home)`"; public const string Site = `"$(Enc $v.site)`"; }" |
    Set-Content -Encoding UTF8 "$tmp\Config.cs"
  & $csc /nologo /target:winexe /platform:x64 /optimize+ "/out:$repo\app\$($v.out)" "/win32icon:$tmp\app.ico" `
    "/r:$core" "/r:$wf" /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    "/resource:$core,Microsoft.Web.WebView2.Core.dll" "/resource:$wf,Microsoft.Web.WebView2.WinForms.dll" "/resource:$ld,WebView2Loader.dll" `
    "$here\App.cs" "$tmp\Config.cs"
  if ($LASTEXITCODE) { throw "csc failed for $($v.out)" }
  "built app\$($v.out)  ($([math]::Round((Get-Item "$repo\app\$($v.out)").Length / 1KB)) KB)"
}
