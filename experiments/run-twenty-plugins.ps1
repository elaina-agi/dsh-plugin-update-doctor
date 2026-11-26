$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-real-plugin-install-update.ps1'
$groups = @(
    @{ name = 'twenty-1'; targets = '[{"name":"dsh-paste-path","from":"0.1.2"},{"name":"dsh-remove-deepseek-logo","from":"1.1.0"},{"name":"dsh-simple-usage-info","from":"0.2.4"},{"name":"dsh-ds-balance","from":"3.2.1"},{"name":"dsh-file-bookmark","from":"0.1.6"}]' },
    @{ name = 'twenty-2'; targets = '[{"name":"dsh-notify-me","from":"1.27.2"},{"name":"@goodandready/dsh-plugin-notify","from":"0.4.8"},{"name":"@showin2333/dsh-plugin-share-image","from":"1.1.2"},{"name":"dsh-session-delete-cascade","from":"1.2.1"},{"name":"dsh-plugin-conversation-purge","from":"1.0.0"}]' },
    @{ name = 'twenty-3'; targets = '[{"name":"dsh-recall-unread","from":"1.2.0"},{"name":"dsh-image-pathify","from":"0.2.2"},{"name":"dsh-chinese-thinking","from":"0.1.0"},{"name":"dsh-magpie-route","from":"1.6.1"},{"name":"dsh-where-did-my-tokens-go","from":"1.9.0"}]' },
    @{ name = 'twenty-4'; targets = '[{"name":"dsh-workspace-api-key","from":"0.3.0"},{"name":"dsh-simple-restart","from":"0.1.2"},{"name":"dsh-desktop-shortcut","from":"0.2.6"},{"name":"dsh-session-fork","from":"0.3.0"},{"name":"dsh-tidy-display","from":"0.6.1"}]' }
)
foreach ($group in $groups) {
    Write-Output "=== GROUP $($group.name) START $(Get-Date -Format o) ==="
    $env:DSH_TEST_TARGETS = $group.targets
    $env:DSH_TEST_OUTPUT = "evidence-$($group.name).json"
    try {
        & pwsh -NoProfile -File $runner
        Write-Output "=== GROUP $($group.name) EXIT $LASTEXITCODE ==="
    } catch {
        Write-Output "=== GROUP $($group.name) FAILED: $($_.Exception.Message) ==="
    }
}
Write-Output '=== ALL GROUPS DONE ==='
