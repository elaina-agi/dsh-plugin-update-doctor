$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$runner=Join-Path $PSScriptRoot 'agent-gate-proof-runner.mjs'
$output=Join-Path $PSScriptRoot 'agent-gate-proof-result.json'
$start=[System.Diagnostics.ProcessStartInfo]::new($env:DSH_NODE_EXECUTABLE)
foreach($argument in @('--expose-internals',$runner,$output)){$start.ArgumentList.Add($argument)}
$start.Environment['ELECTRON_RUN_AS_NODE']='1'
$start.UseShellExecute=$false
$start.RedirectStandardOutput=$true
$start.RedirectStandardError=$true
$start.StandardOutputEncoding=[System.Text.Encoding]::UTF8
$start.StandardErrorEncoding=[System.Text.Encoding]::UTF8
$start.WorkingDirectory=$root
$process=[System.Diagnostics.Process]::Start($start)
$stderr=$process.StandardError.ReadToEndAsync()
$stdout=$process.StandardOutput.ReadToEndAsync()
if(-not $process.WaitForExit(60000)){$process.Kill($true);$process.WaitForExit();throw 'Real Agent gate proof exceeded 60 seconds'}
[Console]::Out.Write($stdout.Result)
[Console]::Error.Write($stderr.Result)
exit $process.ExitCode
