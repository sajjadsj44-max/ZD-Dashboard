# Builds the PDF Takeoff's second DWG reader (ZdDwg.cs — ACadSharp compiled to WebAssembly) into takeoff\dwg\_framework.
#   powershell -ExecutionPolicy Bypass -File tools\takeoff-dwg\build.ps1
# Needs the .NET 10 SDK with its WebAssembly tools (dotnet workload install wasm-tools); $env:DOTNET names its dotnet.exe when
# it is not on PATH. Afterwards bump the ?v= on takeoff.js's <script> in takeoff/index.html: cad.js loads dwg-worker.js and
# dwg/_framework/dotnet.js with it (the other files there carry their own fingerprint in their names).
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot; $repo = Resolve-Path "$here\..\.."
$dotnet = if ($env:DOTNET) { $env:DOTNET } else { "dotnet" }
$tmp = Join-Path $env:TEMP "zd-takeoff-dwg-build"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force $tmp | Out-Null
Copy-Item "$here\ZdDwg.cs", "$here\ZdDwg.csproj" $tmp
& $dotnet publish "$tmp\ZdDwg.csproj" -c Release -o "$tmp\pub" -nologo
if ($LASTEXITCODE) { throw "the build failed" }
$out = Join-Path $repo "takeoff\dwg\_framework"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force $out | Out-Null
# the files as built, without the .br / .gz copies (GitHub Pages compresses what it sends by itself)
Get-ChildItem "$tmp\pub\wwwroot\_framework" -File | Where-Object { $_.Extension -notin ".br", ".gz" } | Copy-Item -Destination $out
$mb = (Get-ChildItem $out -File | Measure-Object Length -Sum).Sum / 1MB
"takeoff\dwg\_framework: {0} files, {1:N1} MB" -f (Get-ChildItem $out -File).Count, $mb
