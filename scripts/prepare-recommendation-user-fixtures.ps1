[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 1000000)]
    [int]$CurriculumNodeId,

    [ValidatePattern('^[A-Za-z0-9_.-]{3,32}$')]
    [string]$CandidateAOwner = "rec_p1",

    [ValidatePattern('^[A-Za-z0-9_.-]{3,32}$')]
    [string]$CandidateBOwner = "rec_p2",

    [ValidatePattern('^[A-Za-z0-9_.-]{3,32}$')]
    [string]$CandidateCOwner = "rec_p1",

    [ValidateRange(1, 1000000)]
    [int]$InteractiveHtmlSourceId = 1,

    [ValidateSet(
        "recommendation-fixtures/k2v-binary-search.mp4",
        "recommendation-fixtures/k2v-priority-queue-binary-tree.mp4"
    )]
    [string]$K2VObjectKey = "recommendation-fixtures/k2v-binary-search.mp4",

    [string]$EnvFile = ".env",
    [switch]$IncludeC2V,
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $repoRoot $EnvFile }

if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Environment file not found: $envPath"
}

$compose = @("compose", "--env-file", $envPath, "-f", "compose.yaml", "-f", "compose.local.yaml")

function Invoke-Psql {
    param([string]$Sql)
    $output = $Sql | & docker exec -i zhiying-postgres sh -c 'psql -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
    if ($LASTEXITCODE -ne 0) {
        throw "PostgreSQL command failed. SQL: $Sql"
    }
    return @($output)
}

function Escape-SqlLiteral {
    param([string]$Value)
    return $Value.Replace("'", "''")
}

function Require-UserId {
    param([string]$Username)
    $safeUsername = Escape-SqlLiteral $Username
    $id = (Invoke-Psql "SELECT id FROM ""user"" WHERE username = '$safeUsername';" | Select-Object -Last 1).Trim()
    if ([string]::IsNullOrWhiteSpace($id)) {
        throw "User does not exist: $Username"
    }
    return [int]$id
}

function Require-Node {
    param([int]$NodeId)
    $result = Invoke-Psql "SELECT title FROM curriculum_node WHERE id = $NodeId;"
    $title = ($result | Select-Object -Last 1).Trim()
    if ([string]::IsNullOrWhiteSpace($title)) {
        throw "Curriculum node does not exist: $NodeId"
    }
    return $title
}

function Require-InteractiveSource {
    param([int]$ResourceId)
    $result = Invoke-Psql @"
SELECT status || '|' || public || '|' || COALESCE(object_key, '')
FROM interactive_html
WHERE id = $ResourceId;
"@
    $value = ($result | Select-Object -Last 1).Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Interactive HTML source does not exist: $ResourceId"
    }
    $parts = $value.Split('|', 3)
    if ($parts.Count -ne 3 -or $parts[0] -ne "FINISHED" -or [string]::IsNullOrWhiteSpace($parts[2])) {
        throw "Interactive HTML source must be FINISHED with a non-empty object_key: $ResourceId ($value)"
    }
    return $parts[2]
}

function Add-CloneSql {
    param(
        [System.Collections.Generic.List[string]]$SqlParts,
        [string]$Kind,
        [string]$Table,
        [string]$LinkTable,
        [string]$LinkColumn,
        [int]$SourceId,
        [int]$OwnerId,
        [int]$NodeId,
        [string]$Title,
        [string]$Summary,
        [string]$ObjectKey,
        [bool]$Featured,
        [int]$DisplayPriority,
        [string]$Prompt,
        [ValidateSet("PENDING", "PASSED", "REJECTED")]
        [string]$QualityStatus = "PENDING"
    )

    $safeKind = Escape-SqlLiteral $Kind
    $safeTable = $Table
    $safeLinkTable = $LinkTable
    $safeLinkColumn = $LinkColumn
    $safeTitle = Escape-SqlLiteral $Title
    $safeSummary = Escape-SqlLiteral $Summary
    $safeObjectKey = Escape-SqlLiteral $ObjectKey
    $safePrompt = Escape-SqlLiteral $Prompt
    $featuredSql = if ($Featured) { "TRUE" } else { "FALSE" }
    $nodeSql = if ($NodeId -gt 0) { $NodeId.ToString() } else { "NULL" }
    $priority = $DisplayPriority.ToString()

    $bookmarkColumns = if ($Table -eq "knowledge_video") { ", bookmarked, bookmarked_at" } else { "" }
    $bookmarkValues = if ($Table -eq "knowledge_video") { ", FALSE, NULL" } else { "" }

    $statement = @"
WITH existing AS (
    SELECT resource.id
    FROM $safeTable resource
    JOIN $safeLinkTable owner_link
      ON owner_link.$safeLinkColumn = resource.id
    WHERE owner_link.user_id = $OwnerId
      AND resource.prompt = '$safePrompt'
      AND resource.object_key = '$safeObjectKey'
    ORDER BY resource.id
    LIMIT 1
), inserted AS (
    INSERT INTO $safeTable
      (status, prompt, object_key, public$bookmarkColumns, created_at, updated_at)
    SELECT
      'FINISHED', '$safePrompt', '$safeObjectKey', TRUE$bookmarkValues,
      NOW(), NOW()
    WHERE NOT EXISTS (SELECT 1 FROM existing)
    RETURNING id
), resource AS (
    SELECT id FROM inserted
    UNION ALL
    SELECT id FROM existing
    LIMIT 1
), owner_link AS (
    INSERT INTO $safeLinkTable ($safeLinkColumn, user_id, created_at)
    SELECT id, $OwnerId, NOW()
    FROM resource
    ON CONFLICT DO NOTHING
), catalog AS (
    INSERT INTO recommendation_resource
      (resource_kind, resource_id, curriculum_node_id, creator_user_id,
       title, summary, quality_status, featured, display_priority,
       created_at, updated_at)
    SELECT
      '$safeKind', id, $nodeSql, $OwnerId,
      '$safeTitle', '$safeSummary', '$QualityStatus', $featuredSql, $priority,
      NOW(), NOW()
    FROM resource
    ON CONFLICT (resource_kind, resource_id) DO UPDATE SET
      curriculum_node_id = EXCLUDED.curriculum_node_id,
      creator_user_id = EXCLUDED.creator_user_id,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      featured = EXCLUDED.featured,
      display_priority = EXCLUDED.display_priority,
      updated_at = NOW()
    RETURNING id
)
SELECT '$safeKind' || ':' || id FROM catalog;
"@
    $SqlParts.Add($statement)
}

Push-Location $repoRoot
try {
    & docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Engine is unavailable"
    }

    $running = @(& docker @compose ps --status running --services)
    if ($running -notcontains "postgres") {
        throw "Postgres service is not running"
    }

    $nodeTitle = Require-Node $CurriculumNodeId
    $ownerA = Require-UserId $CandidateAOwner
    $ownerB = Require-UserId $CandidateBOwner
    $ownerC = Require-UserId $CandidateCOwner
    $source2dKey = Require-InteractiveSource $InteractiveHtmlSourceId

    Write-Host "Recommendation fixture plan"
    Write-Host "- node: $CurriculumNodeId ($nodeTitle)"
    Write-Host "- K2V source object: $K2VObjectKey"
    Write-Host "- 2D source row: interactive_html/$InteractiveHtmlSourceId ($source2dKey)"
    Write-Host "- candidate A owner: $CandidateAOwner (user_id=$ownerA)"
    Write-Host "- candidate B owner: $CandidateBOwner (user_id=$ownerB)"
    Write-Host "- candidate C owner: $CandidateCOwner (user_id=$ownerC)"
    Write-Host "- media is reused; only database resource rows and owner links are distinct"

    $sqlParts = New-Object 'System.Collections.Generic.List[string]'
    $sqlParts.Add("BEGIN;")

    Add-CloneSql -SqlParts $sqlParts -Kind "KNOWLEDGE_VIDEO" -Table "knowledge_video" -LinkTable "user_knowledge_video_link" -LinkColumn "knowledge_video_id" -SourceId 7 -OwnerId $ownerA -NodeId $CurriculumNodeId -Title "fixture-k2v-candidate-A" -Summary "Reused local K2V media; simulated owner rec_p1." -ObjectKey $K2VObjectKey -Featured $false -DisplayPriority 10 -Prompt "fixture-k2v-candidate-A"
    Add-CloneSql -SqlParts $sqlParts -Kind "KNOWLEDGE_VIDEO" -Table "knowledge_video" -LinkTable "user_knowledge_video_link" -LinkColumn "knowledge_video_id" -SourceId 7 -OwnerId $ownerB -NodeId $CurriculumNodeId -Title "fixture-k2v-candidate-B" -Summary "Reused local K2V media; simulated owner rec_p2." -ObjectKey $K2VObjectKey -Featured $false -DisplayPriority 20 -Prompt "fixture-k2v-candidate-B"
    Add-CloneSql -SqlParts $sqlParts -Kind "KNOWLEDGE_VIDEO" -Table "knowledge_video" -LinkTable "user_knowledge_video_link" -LinkColumn "knowledge_video_id" -SourceId 7 -OwnerId $ownerC -NodeId $CurriculumNodeId -Title "fixture-k2v-candidate-C" -Summary "Reused local K2V media; simulated owner rec_p1." -ObjectKey $K2VObjectKey -Featured $false -DisplayPriority 30 -Prompt "fixture-k2v-candidate-C"

    $prompt2dA = "fixture-2d-candidate-A"
    $prompt2dB = "fixture-2d-candidate-B"
    $prompt2dC = "fixture-2d-candidate-C"
    Add-CloneSql -SqlParts $sqlParts -Kind "INTERACTIVE_HTML" -Table "interactive_html" -LinkTable "user_interactive_html_link" -LinkColumn "interactive_html_id" -SourceId $InteractiveHtmlSourceId -OwnerId $ownerA -NodeId $CurriculumNodeId -Title "fixture-2d-candidate-A" -Summary "Reused local 2D media; simulated owner rec_p1." -ObjectKey $source2dKey -Featured $false -DisplayPriority 10 -Prompt $prompt2dA
    Add-CloneSql -SqlParts $sqlParts -Kind "INTERACTIVE_HTML" -Table "interactive_html" -LinkTable "user_interactive_html_link" -LinkColumn "interactive_html_id" -SourceId $InteractiveHtmlSourceId -OwnerId $ownerB -NodeId $CurriculumNodeId -Title "fixture-2d-candidate-B" -Summary "Reused local 2D media; simulated owner rec_p2." -ObjectKey $source2dKey -Featured $false -DisplayPriority 20 -Prompt $prompt2dB
    Add-CloneSql -SqlParts $sqlParts -Kind "INTERACTIVE_HTML" -Table "interactive_html" -LinkTable "user_interactive_html_link" -LinkColumn "interactive_html_id" -SourceId $InteractiveHtmlSourceId -OwnerId $ownerC -NodeId $CurriculumNodeId -Title "fixture-2d-candidate-C" -Summary "Reused local 2D media; simulated owner rec_p1." -ObjectKey $source2dKey -Featured $false -DisplayPriority 30 -Prompt $prompt2dC

    if ($IncludeC2V) {
        Add-CloneSql -SqlParts $sqlParts -Kind "CODE_VIDEO" -Table "code_video" -LinkTable "user_code_video_link" -LinkColumn "code_video_id" -SourceId 7 -OwnerId $ownerA -NodeId 0 -Title "fixture-c2v-two-sum" -Summary "Reused local C2V media; simulated an independently generated featured item." -ObjectKey "recommendation-fixtures/c2v-two-sum.mp4" -Featured $true -DisplayPriority 10 -Prompt "fixture-c2v-two-sum" -QualityStatus "PASSED"
        Add-CloneSql -SqlParts $sqlParts -Kind "CODE_VIDEO" -Table "code_video" -LinkTable "user_code_video_link" -LinkColumn "code_video_id" -SourceId 8 -OwnerId $ownerB -NodeId 0 -Title "fixture-c2v-trapping-rain-water" -Summary "Reused local C2V media; simulated an independently generated featured item." -ObjectKey "recommendation-fixtures/c2v-trapping-rain-water.mp4" -Featured $true -DisplayPriority 20 -Prompt "fixture-c2v-trapping-rain-water" -QualityStatus "PASSED"
    }

    $sqlParts.Add("COMMIT;")
    $sql = $sqlParts -join "`n"

    if (-not $Apply) {
        Write-Host "Dry run only. Add -Apply to write the fixture rows."
        Write-Host "No database changes were made."
        exit 0
    }

    $result = $sql | & docker exec -i zhiying-postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
    if ($LASTEXITCODE -ne 0) {
        throw "Fixture database import failed"
    }
    Write-Host "Created or reused user-owned recommendation fixtures successfully."
    $result | Where-Object { $_ -match '^(KNOWLEDGE_VIDEO|INTERACTIVE_HTML|CODE_VIDEO):' } | ForEach-Object { Write-Host $_ }
}
finally {
    Pop-Location
}
