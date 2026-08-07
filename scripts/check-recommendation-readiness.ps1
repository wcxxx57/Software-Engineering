[CmdletBinding()]
param(
    [ValidateSet("Local", "Production")]
    [string]$Mode = "Local",
    [string]$EnvFile = ".env",
    [switch]$SkipRuntimeChecks
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
    $EnvFile
} else {
    Join-Path $repoRoot $EnvFile
}

$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Write-Check {
    param([string]$Label, [bool]$Passed, [string]$Detail)
    $mark = if ($Passed) { "[OK]" } else { "[FAIL]" }
    Write-Host "$mark $Label - $Detail"
    if (-not $Passed) { $script:failures.Add("${Label}: $Detail") }
}

function Read-DotEnv {
    param([string]$Path)
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') {
            $values[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $values
}

function Is-Placeholder {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
    return $Value -match '(?i)please-change|change-me|replace-me|replace-with|example\.com|your[-_]|^xxx+$|^\.\.\.$'
}

Set-Location $repoRoot
Write-Host "Recommendation readiness check ($Mode)"
Write-Host "Repository: $repoRoot"

Write-Check "Environment file" (Test-Path -LiteralPath $envPath) $envPath
if (-not (Test-Path -LiteralPath $envPath)) { exit 1 }

$values = Read-DotEnv $envPath
$required = @(
    "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB",
    "RABBITMQ_USER", "RABBITMQ_PASSWORD", "JWT_SECRET",
    "KNOWLEDGE_VIDEO_API_KEY", "CODE_VIDEO_API_KEY",
    "KNOWLEDGE_VIDEO_SERVICE_API_KEY", "CODE_VIDEO_SERVICE_API_KEY",
    "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL",
    "VIVO_TTS_APP_ID", "VIVO_TTS_APP_KEY",
    "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY", "STORAGE_BUCKET", "STORAGE_PUBLIC_BASE"
)

foreach ($key in $required) {
    $present = $values.ContainsKey($key) -and -not (Is-Placeholder $values[$key])
    Write-Check "env:$key" $present $(if ($present) { "configured" } else { "missing or placeholder" })
}

foreach ($key in @("KNOWLEDGE_VIDEO_API_KEY", "CODE_VIDEO_API_KEY")) {
    $valid = $values.ContainsKey($key) -and $values[$key].StartsWith("sk-") -and $values[$key].Length -ge 16
    Write-Check "callback key format:$key" $valid "must start with sk- and be at least 16 characters"
}

if ($Mode -eq "Production") {
    $hostOk = $values.ContainsKey("PUBLIC_HOST") -and -not (Is-Placeholder $values["PUBLIC_HOST"]) -and $values["PUBLIC_HOST"] -notmatch 'localhost|127\.0\.0\.1'
    Write-Check "env:PUBLIC_HOST" $hostOk $(if ($hostOk) { "configured for a public host" } else { "missing, placeholder, or local-only" })
    $storagePublicOk = $false
    if ($values.ContainsKey("STORAGE_PUBLIC_BASE")) {
        try {
            $storageUri = [Uri]$values["STORAGE_PUBLIC_BASE"]
            $storagePublicOk = $storageUri.Scheme -eq "https" -and $storageUri.Host -notmatch 'localhost|127\.0\.0\.1'
        } catch { $storagePublicOk = $false }
    }
    Write-Check "env:STORAGE_PUBLIC_BASE" $storagePublicOk $(if ($storagePublicOk) { "public HTTPS URL" } else { "must be a public HTTPS URL" })
}

$videoDirectoryName = [string][char]0x89C6 + [char]0x9891
$videoDirectory = Join-Path $repoRoot $videoDirectoryName
$videoFiles = if (Test-Path -LiteralPath $videoDirectory) {
    @(Get-ChildItem -LiteralPath $videoDirectory -Filter "*.mp4" -File)
} else {
    @()
}
Write-Check "fixture directory" (Test-Path -LiteralPath $videoDirectory) $videoDirectory
Write-Check "K2V fixture count" (@($videoFiles | Where-Object Name -like "K2V_*.mp4").Count -ge 2) "at least two K2V MP4 files"
Write-Check "C2V fixture count" (@($videoFiles | Where-Object Name -like "C2V_*.mp4").Count -ge 2) "at least two C2V MP4 files"
foreach ($file in $videoFiles) {
    Write-Check "fixture:$($file.Name)" ($file.Length -gt 1024) "present and non-empty"
}

$override = if ($Mode -eq "Production") { "compose.prod.yaml" } else { "compose.local.yaml" }
& docker compose --env-file $envPath -f compose.yaml -f $override config --quiet
Write-Check "Compose configuration" ($LASTEXITCODE -eq 0) "compose.yaml + $override"

if (-not $SkipRuntimeChecks) {
    & docker info --format '{{.ServerVersion}}' *> $null
    $dockerReady = $LASTEXITCODE -eq 0
    Write-Check "Docker Engine" $dockerReady $(if ($dockerReady) { "available" } else { "unavailable" })

    if ($dockerReady -and $Mode -eq "Local") {
        $requiredServices = @(
            "postgres", "rabbitmq", "redis", "minio", "backend", "frontend",
            "core-generation", "education2d",
            "knowledge-video-api", "knowledge-video-worker", "knowledge-video-bridge",
            "code-video-api", "code-video-worker", "code-video-bridge"
        )
        $running = @(& docker compose --env-file $envPath -f compose.yaml -f compose.local.yaml ps --status running --services)
        foreach ($service in $requiredServices) {
            Write-Check "service:$service" ($running -contains $service) $(if ($running -contains $service) { "running" } else { "not running" })
        }

        try {
            $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:9000/health" -TimeoutSec 10
            Write-Check "Backend health" ($health.StatusCode -eq 200) "HTTP $($health.StatusCode)"
        } catch {
            Write-Check "Backend health" $false $_.Exception.Message
        }

        try {
            $fixtureHead = Invoke-WebRequest -UseBasicParsing -Method Head -Uri "http://127.0.0.1:3080/storage/recommendation-fixtures/k2v-binary-search.mp4" -TimeoutSec 10
            Write-Check "Storage proxy fixture" ($fixtureHead.StatusCode -in @(200, 206)) "HTTP $($fixtureHead.StatusCode)"
        } catch {
            $warnings.Add("Storage proxy fixture is not imported yet or is not readable: $($_.Exception.Message)")
            Write-Host "[WARN] Storage proxy fixture - not imported or unreadable"
        }

        $schemaSql = "SELECT to_regclass('public.recommendation_resource') IS NOT NULL AND to_regclass('public.plan_recommendation_draft') IS NOT NULL AND to_regclass('public.chat_question') IS NOT NULL;"
        $schemaResult = $schemaSql | & docker exec -i zhiying-postgres sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
        Write-Check "Iteration4 database schema" (($schemaResult | Select-Object -Last 1).Trim() -eq "t") "recommendation, plan draft, and chat tables"
    }
}

if ($warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "Warnings:"
    $warnings | ForEach-Object { Write-Host "- $_" }
}

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Readiness check failed with $($failures.Count) issue(s)."
    exit 1
}

Write-Host ""
Write-Host "Recommendation environment is ready for $Mode checks."
