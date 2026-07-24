param(
    [string]$OutputPath = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$templatePath = Join-Path $repoRoot ".env.example"
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repoRoot ".env"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
}

if ((Test-Path -LiteralPath $OutputPath) -and -not $Force) {
    throw "Configuration already exists: $OutputPath. Use -Force to overwrite it."
}

function New-RandomHex([int]$ByteCount = 24) {
    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Set-EnvValue([string]$Content, [string]$Name, [string]$Value) {
    $pattern = "(?m)^$([regex]::Escape($Name))=.*$"
    if (-not [regex]::IsMatch($Content, $pattern)) {
        throw "Missing setting in .env.example: $Name"
    }
    return [regex]::Replace($Content, $pattern, "$Name=$Value", 1)
}

$content = Get-Content -LiteralPath $templatePath -Raw -Encoding utf8
$generated = @{
    POSTGRES_PASSWORD = "db-$(New-RandomHex 18)"
    RABBITMQ_PASSWORD = "mq-$(New-RandomHex 18)"
    JWT_SECRET = (New-RandomHex 48)
    KNOWLEDGE_EXPLANATION_API_KEY = "sk-$(New-RandomHex 24)"
    PRETEST_API_KEY = "sk-$(New-RandomHex 24)"
    PLAN_API_KEY = "sk-$(New-RandomHex 24)"
    CURRICULUM_API_KEY = "sk-$(New-RandomHex 24)"
    QUIZ_API_KEY = "sk-$(New-RandomHex 24)"
    INTERACTIVE_HTML_API_KEY = "sk-$(New-RandomHex 24)"
    KNOWLEDGE_VIDEO_API_KEY = "sk-$(New-RandomHex 24)"
    CODE_VIDEO_API_KEY = "sk-$(New-RandomHex 24)"
    RECHARGE_API_KEY = "sk-$(New-RandomHex 24)"
    KNOWLEDGE_VIDEO_SERVICE_API_KEY = "svc-$(New-RandomHex 24)"
    CODE_VIDEO_SERVICE_API_KEY = "svc-$(New-RandomHex 24)"
    STORAGE_ACCESS_KEY = "storage-$(New-RandomHex 8)"
    STORAGE_SECRET_KEY = (New-RandomHex 32)
}

foreach ($entry in $generated.GetEnumerator()) {
    $content = Set-EnvValue $content $entry.Key $entry.Value
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}
[System.IO.File]::WriteAllText($OutputPath, $content, [System.Text.UTF8Encoding]::new($false))

Write-Host "Generated local configuration: $OutputPath"
Write-Host "Now fill LLM_BASE_URL, LLM_API_KEY and LLM_MODEL. TTS is optional; the default generates silent videos."
