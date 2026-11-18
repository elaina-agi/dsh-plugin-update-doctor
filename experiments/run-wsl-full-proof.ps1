$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$runner=Join-Path $PSScriptRoot 'wsl-full-proof-runner.mjs'
$outputName=if($env:WSL_FULL_PROOF_MODE -eq 'inplace'){'wsl-full-inplace-proof-result.json'}elseif($env:WSL_FULL_PROOF_MODE -eq 'cold26'){'wsl-full-cold26-proof-result.json'}else{'wsl-full-proof-result.json'}
if($env:WSL_FULL_TARGET -and $env:WSL_FULL_TARGET -ne '0.26.1'){$outputName=$outputName.Replace('-proof-result.json',"-$($env:WSL_FULL_TARGET)-proof-result.json")}
if($env:WSL_GENERATION -eq '1'){$outputName=$outputName.Replace('-proof-result.json','-generation-names-proof-result.json')}
if($env:WSL_GENERATION_PRODUCTION -eq '1'){$outputName=$outputName.Replace('-proof-result.json','-production-proof-result.json')}
if($env:WSL_ROLLING -eq '1'){$outputName=$outputName.Replace('-proof-result.json','-rolling-proof-result.json')}
$output=Join-Path $PSScriptRoot $outputName
$pnpm=Join-Path $env:DSH_HOME 'dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
$start=[System.Diagnostics.ProcessStartInfo]::new($env:DSH_NODE_EXECUTABLE)
foreach($argument in @('--expose-internals',$runner,$output,$pnpm)){$start.ArgumentList.Add($argument)}
$start.Environment['ELECTRON_RUN_AS_NODE']='1'
$start.UseShellExecute=$false;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
$start.StandardOutputEncoding=[System.Text.Encoding]::UTF8;$start.StandardErrorEncoding=[System.Text.Encoding]::UTF8
$start.WorkingDirectory=$root
$process=[System.Diagnostics.Process]::Start($start)
$stderr=$process.StandardError.ReadToEndAsync();$stdout=$process.StandardOutput.ReadToEndAsync()
if(-not $process.WaitForExit(240000)){$process.Kill($true);$process.WaitForExit();[Console]::Out.Write($stdout.Result);[Console]::Error.Write($stderr.Result);throw 'Owned complete WSL proof exceeded 240 seconds'}
[Console]::Out.Write($stdout.Result);[Console]::Error.Write($stderr.Result)
exit $process.ExitCode
