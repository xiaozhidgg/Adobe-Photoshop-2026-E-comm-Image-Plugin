<#
  verify/probe.ps1 -- Photoshop 2026 host-capability probe driver.

  What it does
    1. Records whether Photoshop was ALREADY running (never kills it).
    2. Attaches to the running instance through COM automation
       (New-Object -ComObject Photoshop.Application) inside a background
       PowerShell job so a GUI hang cannot block forever.
    3. Heartbeat DoJavaScript, then DoJavaScriptFile on verify\probe.jsx.
    4. Copies %TEMP%\dsh-ps-probe\result.txt into verify\out\probe-jsx.log.

  Safety
    * NEVER calls Stop-Process on Photoshop.
    * Does not start Photoshop unless -StartIfMissing is explicitly given.
    * probe.jsx only touches documents it creates ("dsh-probe-*") and
      closes them at the end.

  Exit codes
    0 = probe ran and jsx output collected
    1 = probe.jsx missing
    2 = COM job timed out (a modal dialog most likely blocked it)
    3 = DoJavaScriptFile threw
    4 = COM attach failed
    5 = could not parse the job result
    6 = jsx produced no temp output file
    8 = Photoshop is not running and -StartIfMissing was not given
#>
[CmdletBinding()]
param(
    [int]$TimeoutSec = 300,
    [string]$JsxPath,
    [switch]$StartIfMissing
)

$ErrorActionPreference = 'Continue'

$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$outDir = Join-Path $scriptRoot 'out'
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$logFile = Join-Path $outDir 'probe.ps1.log'
if (Test-Path -LiteralPath $logFile) { Remove-Item -LiteralPath $logFile -Force }
if ([string]::IsNullOrWhiteSpace($JsxPath)) { $JsxPath = Join-Path $scriptRoot 'probe.jsx' }

function Say {
    param([string]$m)
    $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m
    Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
    Write-Output $line
}

Say '=== probe.ps1 START ==='
Say "PSScriptRoot=$scriptRoot"
Say "JsxPath=$JsxPath"
Say "TimeoutSec=$TimeoutSec"

$startedByUs = $false
$pre = @(Get-Process -Name Photoshop -ErrorAction SilentlyContinue)
if ($pre.Count -gt 0) {
    Say ('PS_PREEXISTING=YES pids=' + (($pre | ForEach-Object { $_.Id }) -join ','))
    Say ('PS_PREEXISTING_STARTED=' + (($pre | ForEach-Object { $_.StartTime.ToString('s') }) -join ','))
    Say ('PS_PREEXISTING_PATH=' + (($pre | ForEach-Object { $_.Path }) -join ','))
} else {
    Say 'PS_PREEXISTING=NO'
    if ($StartIfMissing) {
        $exe = 'D:\software\Adobe Photoshop 2026\Photoshop.exe'
        if (-not (Test-Path -LiteralPath $exe)) { Say "FATAL Photoshop.exe not found: $exe"; exit 7 }
        Say "STARTING_PHOTOSHOP=$exe"
        Start-Process -FilePath $exe | Out-Null
        $startedByUs = $true
    } else {
        Say 'Photoshop is not running. Re-run with -StartIfMissing to launch it. Aborting.'
        exit 8
    }
}

if (-not (Test-Path -LiteralPath $JsxPath)) { Say "FATAL probe.jsx missing: $JsxPath"; exit 1 }
Say ('JSX_LINES=' + @(Get-Content -LiteralPath $JsxPath).Count)

$tempResult = Join-Path $env:TEMP 'dsh-ps-probe\result.txt'
if (Test-Path -LiteralPath $tempResult) { Remove-Item -LiteralPath $tempResult -Force; Say "REMOVED_STALE_TEMP=$tempResult" }
Say "TEMP_RESULT=$tempResult"

$jobBody = {
    param($jsx)
    $ErrorActionPreference = 'Continue'
    $r = [ordered]@{
        attached      = $false
        psName        = ''
        psVersion     = ''
        heartbeat     = ''
        heartbeatErr  = ''
        fileResult    = ''
        fileErr       = ''
        attachErr     = ''
    }
    $app = $null
    for ($i = 0; $i -lt 12; $i++) {
        try { $app = New-Object -ComObject Photoshop.Application; break } catch { Start-Sleep -Seconds 5 }
    }
    if ($null -eq $app) { $r.attachErr = 'COM attach failed after 12 attempts (60s)'; $r | ConvertTo-Json -Compress; return }
    $r.attached = $true
    try { $r.psName = [string]$app.Name } catch { $r.psName = 'ERR ' + $_.Exception.Message }
    try { $r.psVersion = [string]$app.Version } catch { $r.psVersion = 'ERR ' + $_.Exception.Message }
    try { $r.heartbeat = [string]$app.DoJavaScript('"hb-ok"') } catch { $r.heartbeatErr = $_.Exception.Message }
    try { $r.fileResult = [string]$app.DoJavaScriptFile($jsx) } catch { $r.fileErr = $_.Exception.Message }
    $r | ConvertTo-Json -Depth 5 -Compress
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$job = Start-Job -ScriptBlock $jobBody -ArgumentList $JsxPath
$done = Wait-Job -Job $job -Timeout $TimeoutSec
$sw.Stop()
Say ('JOB_COMPLETED_IN_TIME=' + [bool]$done + ' elapsedSec=' + [math]::Round($sw.Elapsed.TotalSeconds, 1))

$exitCode = 0

if (-not $done) {
    Say "TIMEOUT: COM call did not return within ${TimeoutSec}s -> Stop-Job"
    Stop-Job -Job $job -ErrorAction SilentlyContinue
    $partial = @(Receive-Job -Job $job -ErrorAction SilentlyContinue)
    Say ('PARTIAL_JOB_OUTPUT=' + (($partial | Out-String).Trim()))
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    Say 'NOTE: Photoshop may still be busy executing the script. It was NOT killed.'
    $exitCode = 2
} else {
    $jobState = $job.State
    $raw = @(Receive-Job -Job $job -ErrorAction SilentlyContinue) | Out-String
    $reason = $null
    try { $reason = $job.ChildJobs[0].JobStateInfo.Reason } catch { }
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    Say "JOB_STATE=$jobState"
    if ($reason) { Say ('JOB_REASON=' + $reason.ToString()) }
    try {
        $obj = $raw.Trim() | ConvertFrom-Json
        Say ('ATTACHED=' + $obj.attached)
        Say ('PS_NAME=' + $obj.psName)
        Say ('PS_VERSION=' + $obj.psVersion)
        Say ('HEARTBEAT=' + $obj.heartbeat)
        if ($obj.heartbeatErr) { Say ('HEARTBEAT_ERR=' + $obj.heartbeatErr) }
        Say ('DOJAVASCRIPTFILE_RESULT=' + $obj.fileResult)
        if ($obj.fileErr) { Say ('DOJAVASCRIPTFILE_ERR=' + $obj.fileErr); $exitCode = 3 }
        if ($obj.attachErr) { Say ('ATTACH_ERR=' + $obj.attachErr); $exitCode = 4 }
    } catch {
        Say ('JSON_PARSE_FAIL=' + $_.Exception.Message)
        Say ('RAW_JOB_OUTPUT=' + $raw.Trim())
        $exitCode = 5
    }
}

if (Test-Path -LiteralPath $tempResult) {
    $dest = Join-Path $outDir 'probe-jsx.log'
    Copy-Item -LiteralPath $tempResult -Destination $dest -Force
    Say "JSX_LOG_COPIED=$dest"
    $lines = @(Get-Content -LiteralPath $dest -Encoding utf8)
    Say ('JSX_LOG_LINES=' + $lines.Count)
    Say '---- JSX LOG BEGIN ----'
    foreach ($l in $lines) { Write-Output $l }
    Say '---- JSX LOG END ----'
} else {
    Say "WARN jsx temp output not found: $tempResult"
    if ($exitCode -eq 0) { $exitCode = 6 }
}

$post = @(Get-Process -Name Photoshop -ErrorAction SilentlyContinue)
Say ('PS_POST_COUNT=' + $post.Count + ' pids=' + (($post | ForEach-Object { $_.Id }) -join ','))
Say ('STARTED_PS_BY_US=' + $startedByUs)
Say "=== probe.ps1 END exit=$exitCode ==="
exit $exitCode
