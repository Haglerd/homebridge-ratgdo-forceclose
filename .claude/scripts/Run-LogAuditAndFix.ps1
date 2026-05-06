# Run-LogAuditAndFix.ps1
# Invoked by Windows Task Scheduler to run unattended log-audit-and-fix
# for homebridge-ratgdo-forceclose.

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$LogDir = Join-Path $env:USERPROFILE '.claude\log-audit-history'
$LogFile = Join-Path $LogDir ("homebridge-ratgdo-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $ProjectRoot

"=== Run-LogAuditAndFix start: $(Get-Date -Format 'o') ===" | Out-File -FilePath $LogFile -Encoding utf8
"Project root: $ProjectRoot" | Out-File -FilePath $LogFile -Append -Encoding utf8

$proc = Start-Process -FilePath 'claude' `
    -ArgumentList '-p', '/log-audit-and-fix' `
    -WorkingDirectory $ProjectRoot `
    -RedirectStandardOutput "$LogFile.stdout" `
    -RedirectStandardError "$LogFile.stderr" `
    -NoNewWindow `
    -PassThru

if (-not $proc.WaitForExit(30 * 60 * 1000)) {
    $proc.Kill()
    "ERROR: timed out after 30 minutes — killed process" | Out-File -FilePath $LogFile -Append -Encoding utf8
    exit 1
}

"=== STDOUT ===" | Out-File -FilePath $LogFile -Append -Encoding utf8
Get-Content "$LogFile.stdout" -ErrorAction SilentlyContinue | Out-File -FilePath $LogFile -Append -Encoding utf8
"=== STDERR ===" | Out-File -FilePath $LogFile -Append -Encoding utf8
Get-Content "$LogFile.stderr" -ErrorAction SilentlyContinue | Out-File -FilePath $LogFile -Append -Encoding utf8
"=== Exit code: $($proc.ExitCode) ===" | Out-File -FilePath $LogFile -Append -Encoding utf8
"=== End: $(Get-Date -Format 'o') ===" | Out-File -FilePath $LogFile -Append -Encoding utf8

Remove-Item "$LogFile.stdout" -ErrorAction SilentlyContinue
Remove-Item "$LogFile.stderr" -ErrorAction SilentlyContinue

Get-ChildItem -Path $LogDir -Filter "homebridge-ratgdo-*.log" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 30 |
    Remove-Item -Force -ErrorAction SilentlyContinue

exit $proc.ExitCode
