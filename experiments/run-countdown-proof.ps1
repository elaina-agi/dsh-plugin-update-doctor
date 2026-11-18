$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$runner = Join-Path $PSScriptRoot 'countdown-proof-runner.mjs'
$pnpm = Join-Path $env:DSH_HOME 'dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
if (-not (Test-Path -LiteralPath $pnpm)) { throw 'Bundled pnpm unavailable' }
if (-not $env:DSH_NODE_EXECUTABLE -or -not $env:DSH_INSTALL_DIR) { throw 'Installed runtime environment unavailable' }
$codes = @()
foreach ($mode in @('official', 'doctor')) {
    $output = Join-Path $PSScriptRoot ('countdown-' + $mode + '-proof-result.json')
    $start = [System.Diagnostics.ProcessStartInfo]::new($env:DSH_NODE_EXECUTABLE)
    foreach ($argument in @('--expose-internals', $runner, $output, $pnpm, $mode)) { $start.ArgumentList.Add($argument) }
    $start.Environment['ELECTRON_RUN_AS_NODE'] = '1'
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $start.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $start.WorkingDirectory = $root
    $process = [System.Diagnostics.Process]::Start($start)
    $stderr = $process.StandardError.ReadToEndAsync()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    if (-not $process.WaitForExit(240000)) {
        # Only the Electron child launched above and its owned fixture children.
        $process.Kill($true)
        $process.WaitForExit()
        [Console]::Out.Write($stdout.Result)
        [Console]::Error.Write($stderr.Result)
        throw ('Owned ' + $mode + ' countdown test exceeded deadline; outcome unknown, no success inferred')
    }
    [Console]::Out.Write($stdout.Result)
    [Console]::Error.Write($stderr.Result)
    $codes += $process.ExitCode
}
if ($codes | Where-Object { $_ -ne 0 }) { exit 1 }
exit 0
