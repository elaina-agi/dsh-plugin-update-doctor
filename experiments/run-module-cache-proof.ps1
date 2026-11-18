$ErrorActionPreference='Stop'
$workspace=Split-Path $PSScriptRoot -Parent
$runner=Join-Path $PSScriptRoot 'module-cache-proof-runner.mjs'
$output=Join-Path $PSScriptRoot 'module-cache-proof-result.json'
$pnpm=Join-Path $env:DSH_HOME 'dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
if(-not (Test-Path -LiteralPath $pnpm)){throw 'Bundled pnpm unavailable'}
if(-not $env:DSH_INSTALL_DIR.Contains('app.asar')){throw 'Installed ASAR required'}
$results=@()
$failed=$false
foreach($mode in @('official','generic','cold-v2')){
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
 if(-not $process.WaitForExit(240000)){$process.Kill($true);$process.WaitForExit();$failed=$true}
 $outText=$stdout.Result
 $errorText=$stderr.Result
 [Console]::Out.Write($outText)
 [Console]::Error.Write($errorText)
 $resultLines=@($outText -split "`r?`n" | Where-Object {$_ -like 'MODULE_CACHE_PROOF_RESULT *'})
 if($resultLines.Count -eq 1){$value=$resultLines[0].Substring('MODULE_CACHE_PROOF_RESULT '.Length)|ConvertFrom-Json; $results+=@{method=$mode;exitCode=$process.ExitCode;evidence=$value}}
 else{$results+=@{method=$mode;exitCode=$process.ExitCode;evidenceMissing=$true;stderr=$errorText};$failed=$true}
 if($process.ExitCode -ne 0){$failed=$true}
}
@{schemaVersion=1;methods=$results;separateProcesses=($results.Count -eq 3 -and @($results.evidence.pid|Select-Object -Unique).Count -eq 3);completed=-not $failed}|ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $output -Encoding utf8
if($failed){throw 'Module-cache proof runner failed; collected result includes actual error'}
Write-Host "Saved module cache proof: $output"
