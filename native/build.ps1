$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler is unavailable.' }
$source = Join-Path $PSScriptRoot 'LockProbe.cs'
$outputDirectory = Join-Path $PSScriptRoot 'win-x64'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$output = Join-Path $outputDirectory 'lock-probe.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /debug- /reference:System.Web.Extensions.dll "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw "Lock probe compilation failed: $LASTEXITCODE" }
Get-FileHash -LiteralPath $output -Algorithm SHA256
