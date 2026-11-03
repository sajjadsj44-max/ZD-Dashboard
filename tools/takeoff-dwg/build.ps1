# Builds the PDF Takeoff's second DWG reader (ZdDwg.cs — ACadSharp compiled to WebAssembly) into takeoff\dwg\_framework.
#   powershell -ExecutionPolicy Bypass -File tools\takeoff-dwg\build.ps1
# Needs the .NET 10 SDK with its WebAssembly tools (dotnet workload install wasm-tools) and git; $env:DOTNET names its dotnet.exe
# when it is not on PATH. ACadSharp is built from its own source — v3.8.35 and its CSUtilities submodule at a6505ab, fetched from
# GitHub (MIT) — with acadsharp.patch: a block's objects are read only once something uses the block, so a drawing full of block
# definitions nothing inserts (the JADE masonry drawing: 770,000 of its 1,016,357 objects) fits the browser's 4 GB, and the
# paper-space layouts' own objects are never read (the takeoff shows model space only; the Zameen Quadrangle layout plans hold
# 740,000 objects in blocks only their layouts insert).
# Afterwards bump the ?v= on takeoff.js's <script> in takeoff/index.html: cad.js loads dwg/_framework/dotnet.js with it (the other
# files there carry their own fingerprint in their names).
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot; $repo = Resolve-Path "$here\..\.."
$dotnet = if ($env:DOTNET) { $env:DOTNET } else { "dotnet" }
$tmp = Join-Path $env:TEMP "zd-takeoff-dwg-build"   # (a short path: ACadSharp's tree is deep)
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force $tmp | Out-Null
Copy-Item "$here\ZdDwg.cs", "$here\ZdDwg.csproj" $tmp
$acs = "$tmp-acs"; Remove-Item -Recurse -Force $acs -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force $acs | Out-Null   # (beside the project: not compiled into it)
Invoke-WebRequest -UseBasicParsing "https://github.com/DomCR/ACadSharp/archive/refs/tags/v3.8.35.tar.gz" -OutFile "$acs\acadsharp.tgz"
Invoke-WebRequest -UseBasicParsing "https://github.com/DomCR/CSUtilities/archive/a6505ab24bb45eac91e912179b2049136b7e88af.tar.gz" -OutFile "$acs\csutilities.tgz"
tar -xzf "$acs\acadsharp.tgz" -C $acs --exclude="*/samples/*" --exclude="*/ACadSharp.Tests/*"; if ($LASTEXITCODE) { throw "ACadSharp could not be unpacked" }
tar -xzf "$acs\csutilities.tgz" -C $acs; if ($LASTEXITCODE) { throw "CSUtilities could not be unpacked" }
$src = Join-Path $acs "ACadSharp-3.8.35"; Remove-Item -Recurse -Force "$src\src\CSUtilities" -ErrorAction SilentlyContinue
Move-Item (Join-Path $acs "CSUtilities-a6505ab24bb45eac91e912179b2049136b7e88af") "$src\src\CSUtilities"
Push-Location $src; try { git -c core.autocrlf=false apply -p1 --whitespace=nowarn "$here\acadsharp.patch"; if ($LASTEXITCODE) { throw "acadsharp.patch does not apply" } } finally { Pop-Location }
& $dotnet publish "$tmp\ZdDwg.csproj" -c Release -o "$tmp\pub" -nologo "-p:AcsDir=$src"
if ($LASTEXITCODE) { throw "the build failed" }
$out = Join-Path $repo "takeoff\dwg\_framework"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force $out | Out-Null
# the files as built, without the .br / .gz copies (GitHub Pages compresses what it sends by itself)
Get-ChildItem "$tmp\pub\wwwroot\_framework" -File | Where-Object { $_.Extension -notin ".br", ".gz" } | Copy-Item -Destination $out
$mb = (Get-ChildItem $out -File | Measure-Object Length -Sum).Sum / 1MB
"takeoff\dwg\_framework: {0} files, {1:N1} MB" -f (Get-ChildItem $out -File).Count, $mb
