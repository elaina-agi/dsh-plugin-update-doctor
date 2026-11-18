$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$runner=Join-Path $PSScriptRoot 'recovery-v3-proof-runner.mjs'
$output=Join-Path $PSScriptRoot 'recovery-v3-proof-result.json'
$pnpm=Join-Path $env:DSH_HOME 'dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
$start=[System.Diagnostics.ProcessStartInfo]::new($env:DSH_NODE_EXECUTABLE)
foreach($arg in @('--expose-internals',$runner,$output,$pnpm)){$start.ArgumentList.Add($arg)}
$start.Environment['ELECTRON_RUN_AS_NODE']='1';$start.UseShellExecute=$false
$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
$start.StandardOutputEncoding=[System.Text.Encoding]::UTF8;$start.StandardErrorEncoding=[System.Text.Encoding]::UTF8
$start.WorkingDirectory=$root
$process=[System.Diagnostics.Process]::Start($start)
$stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
if(-not $process.WaitForExit(240000)){$process.Kill($true);$process.WaitForExit();throw 'Owned recovery proof exceeded deadline; outcome unknown'}
[Console]::Out.Write($stdout.Result);[Console]::Error.Write($stderr.Result)
exit $process.ExitCode
