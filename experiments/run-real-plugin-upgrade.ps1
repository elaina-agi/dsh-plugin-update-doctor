$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$runtime = 'C:\Users\Flyking\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies'
$runner = Join-Path $PSScriptRoot 'real-plugin-upgrade-runner.mjs'
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'Expected owned runner is absent' }
if (-not $env:DSH_NODE_EXECUTABLE -or $env:DSH_INSTALL_DIR -notlike '*app.asar*') { throw 'Installed Electron runtime is absent' }
$outputRoot = Join-Path $taskRoot 'artifacts\real-plugin-upgrade'
$null = New-Item -ItemType Directory -Force -Path $outputRoot
$output = Join-Path $outputRoot 'evidence.json'
if (Test-Path -LiteralPath $output) { throw 'Refuse to overwrite earlier evidence' }
& (Join-Path $runtime 'node\bin\node.exe') --check $runner
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$start = [System.Diagnostics.ProcessStartInfo]::new($env:DSH_NODE_EXECUTABLE)
foreach ($argument in @('--expose-internals', $runner, $output, (Join-Path $runtime 'pnpm\bin\pnpm.mjs'))) { $start.ArgumentList.Add($argument) }
$start.Environment['ELECTRON_RUN_AS_NODE'] = '1'
$start.UseShellExecute = $false
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$start.StandardErrorEncoding = [System.Text.Encoding]::UTF8
$start.WorkingDirectory = $taskRoot
$process = [System.Diagnostics.Process]::Start($start)
try {
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    Write-Output "REAL_UPGRADE_PID=$($process.Id)"
    if (-not $process.WaitForExit(1500000)) {
        $process.Kill($true); $process.WaitForExit()
        [Console]::Out.Write($stdout.Result); [Console]::Error.Write($stderr.Result)
        throw 'Real-plugin upgrade run exceeded its owned deadline; outcome unknown.'
    }
    [Console]::Out.Write($stdout.Result)
    [Console]::Error.Write($stderr.Result)
    exit $process.ExitCode
} finally { $process.Dispose() }
