$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$runner=Join-Path $PSScriptRoot 'wsl-online-proof-runner.mjs'
$output=Join-Path $PSScriptRoot 'wsl-online-proof-result.json'
$pnpm=Join-Path $env:DSH_HOME 'dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
$start=[System.Diagnostics.ProcessStartInfo]::new($env:DSH_NODE_EXECUTABLE)
foreach($argument in @('--expose-internals',$runner,$output,$pnpm)){$start.ArgumentList.Add($argument)}
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
if(-not $process.WaitForExit(180000)){$process.Kill($true);$process.WaitForExit();throw 'Isolated WSL proof exceeded 180 seconds'}
[Console]::Out.Write($stdout.Result)
[Console]::Error.Write($stderr.Result)
exit $process.ExitCode
