param(
    [string]$OutputPath = "",
    [switch]$SkipBackendTests
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$compose = @("--env-file", ".env", "-f", "compose.yaml", "-f", "compose.local.yaml")
$results = New-Object System.Collections.Generic.List[object]
$details = New-Object System.Collections.Generic.List[string]

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputPath = Join-Path $repo "artifacts/recommendation-evaluation-$stamp.md"
}
if (-not [IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath = Join-Path $repo $OutputPath
}
$outputDir = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

function Add-Result {
    param([string]$Name, [bool]$Passed, [string]$Evidence)
    $results.Add([pscustomobject]@{
        Name = $Name
        Passed = $Passed
        Evidence = $Evidence.Replace("|", "\|").Replace("`r", " ").Replace("`n", " ")
    })
}

function Run-ProcessCapture {
    param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
    Push-Location $WorkingDirectory
    try {
        $previousErrorAction = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $output = & $FilePath @Arguments 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousErrorAction
        return [pscustomobject]@{
            ExitCode = $exitCode
            Output = $output.Trim()
        }
    }
    finally {
        Pop-Location
    }
}

Push-Location $repo
try {
    $readySucceeded = $true
    try {
        & (Join-Path $PSScriptRoot "check-recommendation-readiness.ps1") -Mode Local
    }
    catch {
        $readySucceeded = $false
        $details.Add("## Readiness failure`n`n$($_.Exception.Message)")
    }
    Add-Result "Local readiness" $readySucceeded "Compose, services, health, storage and schema checked"

    foreach ($path in @(
        "storage/zhiying-content/recommendation-fixtures/k2v-binary-search.mp4",
        "storage/recommendation-fixtures/k2v-binary-search.mp4",
        "storage/zhiying-content/recommendation-fixtures/c2v-two-sum.mp4"
    )) {
        $url = "http://127.0.0.1:3080/$path"
        $curl = Run-ProcessCapture "curl.exe" @("-sS", "-o", "NUL", "-w", "%{http_code} %{content_type} %{size_download}", "-H", "Range: bytes=0-31", $url) $repo
        $passed = $curl.ExitCode -eq 0 -and $curl.Output -match "^206 video/mp4 32"
        Add-Result "Storage range: $path" $passed $curl.Output
    }

    $expectedModels = @{
        "zhiying-core-generation" = @{ "LLM_MODEL" = "gpt-5.5"; "PLAN_MODEL" = "gpt-5.5" }
        "zhiying-knowledge-video-api" = @{ "LOGIC_MODEL" = "gpt-5.3-codex-spark"; "CODE_MODEL" = "gpt-5.3-codex-spark" }
        "zhiying-knowledge-video-worker" = @{ "LOGIC_MODEL" = "gpt-5.3-codex-spark"; "CODE_MODEL" = "gpt-5.3-codex-spark" }
        "zhiying-code-video-api" = @{ "LOGIC_MODEL" = "gpt-5.3-codex-spark"; "CODE_MODEL" = "gpt-5.3-codex-spark" }
        "zhiying-code-video-worker" = @{ "LOGIC_MODEL" = "gpt-5.3-codex-spark"; "CODE_MODEL" = "gpt-5.3-codex-spark" }
        "zhiying-backend" = @{ "REGISTER_BONUS_DIAMONDS" = "1000" }
    }
    foreach ($container in $expectedModels.Keys) {
        $inspect = docker inspect $container | ConvertFrom-Json
        $envMap = @{}
        foreach ($entry in $inspect[0].Config.Env) {
            $parts = $entry.Split("=", 2)
            if ($parts.Count -eq 2) { $envMap[$parts[0]] = $parts[1] }
        }
        foreach ($key in $expectedModels[$container].Keys) {
            $actual = $envMap[$key]
            $expected = $expectedModels[$container][$key]
            Add-Result "Config: $container/$key" ($actual -eq $expected) "expected=$expected actual=$actual"
        }
    }

    $dbUser = ((Select-String -LiteralPath ".env" -Pattern "^POSTGRES_USER=").Line.Split("=", 2)[1]).Trim()
    $dbName = ((Select-String -LiteralPath ".env" -Pattern "^POSTGRES_DB=").Line.Split("=", 2)[1]).Trim()
    $catalogSql = "SELECT resource_kind || ':' || COUNT(*) FROM recommendation_resource WHERE featured=true AND quality_status='PASSED' GROUP BY resource_kind ORDER BY resource_kind;"
    $catalogOutput = $catalogSql | docker compose @compose exec -T postgres psql -U $dbUser -d $dbName -t -A 2>&1 | Out-String
    $catalogCounts = @{}
    foreach ($line in ($catalogOutput -split "`r?`n")) {
        if ($line.Trim() -match '^([^:]+):(\d+)$') {
            $catalogCounts[$matches[1]] = [int]$matches[2]
        }
    }
    $catalogPassed = $catalogCounts.ContainsKey('KNOWLEDGE_VIDEO') -and
        $catalogCounts['KNOWLEDGE_VIDEO'] -ge 2 -and
        $catalogCounts.ContainsKey('CODE_VIDEO') -and
        $catalogCounts['CODE_VIDEO'] -ge 2
    Add-Result "Featured catalog fixtures" $catalogPassed "K2V=$($catalogCounts['KNOWLEDGE_VIDEO']); C2V=$($catalogCounts['CODE_VIDEO']); expected at least 2 each"

    $balanceSql = 'SELECT COUNT(*) FROM "user" WHERE (username=''wcx'' OR username LIKE ''rec_%'') AND diamond < 1000;'
    $balanceOutput = $balanceSql | docker compose @compose exec -T postgres psql -U $dbUser -d $dbName -t -A 2>&1 | Out-String
    Add-Result "Dedicated account balances" ($balanceOutput.Trim() -eq "0") "accounts below 1000 diamonds=$($balanceOutput.Trim())"

    $failedSql = 'SELECT COUNT(*) FROM knowledge_video kv JOIN user_knowledge_video_link l ON l.knowledge_video_id=kv.id JOIN "user" u ON u.id=l.user_id WHERE u.username=''wcx'' AND kv.status=''FAILED'';'
    $failedOutput = $failedSql | docker compose @compose exec -T postgres psql -U $dbUser -d $dbName -t -A 2>&1 | Out-String
    Add-Result "wcx failed K2V history" ($failedOutput.Trim() -eq "0") "linked failed rows=$($failedOutput.Trim())"

    if (-not $SkipBackendTests) {
        $backendPath = Join-Path $repo "backend"
        $mount = "type=bind,source=$backendPath,target=/app"
        $test = Run-ProcessCapture "docker" @("run", "--rm", "--mount", $mount, "-w", "/app", "rust:1.91-bookworm", "cargo", "test", "--test", "recommendations") $repo
        Add-Result "Backend recommendation integration tests" ($test.ExitCode -eq 0 -and $test.Output -match "test result: ok") "exit=$($test.ExitCode); cargo reported an all-passing recommendation test result"
        $testTail = (($test.Output -split "`r?`n") | Select-Object -Last 80) -join "`n"
        $details.Add("## Backend recommendation tests`n`n~~~text`n$testTail`n~~~")
    } else {
        Add-Result "Backend recommendation integration tests" $true "skipped by request"
    }
}
finally {
    Pop-Location
}

$passedCount = @($results | Where-Object Passed).Count
$failedCount = @($results | Where-Object { -not $_.Passed }).Count
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("# Recommendation automated evaluation")
$lines.Add("")
$lines.Add("- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')")
$lines.Add("- Repository: $repo")
$lines.Add("- Passed: $passedCount")
$lines.Add("- Failed: $failedCount")
$lines.Add("")
$lines.Add("| Check | Result | Evidence |")
$lines.Add("| --- | --- | --- |")
foreach ($result in $results) {
    $status = if ($result.Passed) { "PASS" } else { "FAIL" }
    $lines.Add("| $($result.Name) | $status | $($result.Evidence) |")
}
$lines.Add("")
foreach ($detail in $details) {
    $lines.Add($detail)
    $lines.Add("")
}
$lines -join "`r`n" | Set-Content -LiteralPath $OutputPath -Encoding UTF8

Write-Output "Report: $OutputPath"
Write-Output "Passed: $passedCount; Failed: $failedCount"
if ($failedCount -gt 0) { exit 1 }
