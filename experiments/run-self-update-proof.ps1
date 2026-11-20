$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$runner = Join-Path $PSScriptRoot 'self-update-proof-runner.mjs'
$output = Join-Path $PSScriptRoot 'self-update-proof-result.json'
$pnpm = Join-Path $env:DSH_HOME 'dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
if (-not (Test-Path -LiteralPath $pnpm)) { throw 'Bundled pnpm is unavailable' }
if (-not $env:DSH_INSTALL_DIR -or -not $env:DSH_INSTALL_DIR.Contains('app.asar') -or -not $env:DSH_NODE_EXECUTABLE) { throw 'Installed ASAR Electron runtime is required' }
$results = @()
$failed = $false
foreach ($mode in @('update-good', 'bad-rollback')) {
    $start = [System.Diagnostics.ProcessStartInfo]::new($env:DSH_NODE_EXECUTABLE)
    foreach ($argument in @('--expose-internals', $runner, $mode, $pnpm)) { $start.ArgumentList.Add($argument) }
    $start.Environment['ELECTRON_RUN_AS_NODE'] = '1'
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $start.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $start.WorkingDirectory = $workspace
    $process = [System.Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(240000)) {
        $process.Kill($true); $process.WaitForExit()
        $failed = $true
    }
    $outText = $stdout.Result; $errorText = $stderr.Result
    [Console]::Out.Write($outText); [Console]::Error.Write($errorText)
    $lines = @($outText -split "`r?`n" | Where-Object { $_ -like 'SELF_UPDATE_PROOF_RESULT *' })
    if ($lines.Count -eq 1) {
        $value = $lines[0].Substring('SELF_UPDATE_PROOF_RESULT '.Length) | ConvertFrom-Json
        $results += @{ mode = $mode; exitCode = $process.ExitCode; evidence = $value }
        if (-not $value.passed -or -not $value.cleaned) { $failed = $true }
    } else {
        $results += @{ mode = $mode; exitCode = $process.ExitCode; evidenceMissing = $true; stderr = $errorText }
        $failed = $true
    }
    if ($process.ExitCode -ne 0) { $failed = $true }
}
@{ schemaVersion = 1; modes = $results; separateProcesses = ($results.Count -eq 2 -and @($results.evidence.pid | Select-Object -Unique).Count -eq 2); completed = -not $failed } | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $output -Encoding utf8
if ($failed) { throw 'Owned self-update proof failed; raw results retain actual failure and cleanup evidence' }
Write-Host 'Saved isolated self-update proof results; raw JSON remains private.'
