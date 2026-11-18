$ErrorActionPreference='Stop'
$workspace=Split-Path $PSScriptRoot -Parent
$runner=Join-Path $PSScriptRoot 'agent-disposal-proof-runner.mjs'
$output=Join-Path $PSScriptRoot 'agent-disposal-proof-result.json'
$pnpm=Join-Path $env:DSH_HOME 'dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
if(-not(Test-Path -LiteralPath $pnpm)){throw 'Bundled pnpm unavailable'}
if(-not $env:DSH_NODE_EXECUTABLE -or -not $env:DSH_INSTALL_DIR.Contains('app.asar')){throw 'Installed ASAR runtime required'}
$results=@()
$failed=$false
foreach($mode in @('legacy-claim','fixed-gate')){
 $start=[System.Diagnostics.ProcessStartInfo]::new($env:DSH_NODE_EXECUTABLE)
 foreach($argument in @('--expose-internals',$runner,$mode,$pnpm)){$start.ArgumentList.Add($argument)}
 $start.Environment['ELECTRON_RUN_AS_NODE']='1'
 $start.UseShellExecute=$false
 $start.RedirectStandardOutput=$true
 $start.RedirectStandardError=$true
 $start.StandardOutputEncoding=[System.Text.Encoding]::UTF8
 $start.StandardErrorEncoding=[System.Text.Encoding]::UTF8
 $start.WorkingDirectory=$workspace
 $process=[System.Diagnostics.Process]::Start($start)
 $stdout=$process.StandardOutput.ReadToEndAsync()
 $stderr=$process.StandardError.ReadToEndAsync()
 $timedOut=-not $process.WaitForExit(120000)
 if($timedOut){
   # This child and its descendants are created exclusively for this fixture.
   $process.Kill($true);$process.WaitForExit();$failed=$true
 }
 $outText=$stdout.Result;$errorText=$stderr.Result
 [Console]::Out.Write($outText);[Console]::Error.Write($errorText)
 $lines=@($outText -split "`r?`n" | Where-Object {$_ -like 'AGENT_DISPOSAL_PROOF_RESULT *'})
 if($lines.Count -eq 1){
  $evidence=$lines[0].Substring('AGENT_DISPOSAL_PROOF_RESULT '.Length)|ConvertFrom-Json
  $results+=@{mode=$mode;exitCode=$process.ExitCode;timedOut=$timedOut;evidence=$evidence}
  if(-not $evidence.passed -or -not $evidence.cleanedOwnedRoot){$failed=$true}
 }else{$results+=@{mode=$mode;exitCode=$process.ExitCode;timedOut=$timedOut;evidenceMissing=$true;outcome='unknown';stderr=$errorText};$failed=$true}
 if($process.ExitCode -ne 0){$failed=$true}
}
@{schemaVersion=1;completed=-not $failed;separateProcesses=(@($results.evidence.pid|Select-Object -Unique).Count -eq 2);methods=$results}|ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $output -Encoding utf8
if($failed){throw 'Owned Agent disposal proof failed; collected evidence does not infer success'}
Write-Host "Saved Agent disposal proof: $output"
