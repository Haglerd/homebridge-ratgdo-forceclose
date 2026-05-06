# Register-LogAuditTask.ps1
# Run ONCE as Administrator to install the scheduled task for
# homebridge-ratgdo-forceclose.

[CmdletBinding()]
param(
    [int]$IntervalHours = 6,
    [string]$StartTime = '06:30',
    [string]$TaskName = 'Claude-LogAuditAndFix-homebridge-ratgdo-forceclose'
)

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Re-run this script in an elevated PowerShell window."
    exit 1
}

$ProjectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$RunScript = Join-Path $ProjectRoot '.claude\scripts\Run-LogAuditAndFix.ps1'

if (-not (Test-Path $RunScript)) {
    Write-Error "Run script not found at: $RunScript"
    exit 1
}

$Trigger = New-ScheduledTaskTrigger -Daily -At $StartTime
$Trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $StartTime -RepetitionInterval (New-TimeSpan -Hours $IntervalHours) -RepetitionDuration ([TimeSpan]::FromDays(365 * 10))).Repetition

$Action = New-ScheduledTaskAction `
    -Execute 'pwsh.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunScript`""

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 35) `
    -MultipleInstances IgnoreNew

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

$Task = New-ScheduledTask -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal `
    -Description "Runs /log-audit-and-fix for homebridge-ratgdo-forceclose every $IntervalHours hours. Pulls Homebridge journalctl, queues findings, runs auto-fix pipeline through PR."

Register-ScheduledTask -TaskName $TaskName -InputObject $Task -Force

Write-Host ""
Write-Host "✓ Registered scheduled task: $TaskName"
Write-Host "  Trigger: every $IntervalHours hours starting $StartTime"
Write-Host "  Run script: $RunScript"
Write-Host "  Logs: $env:USERPROFILE\.claude\log-audit-history\"
Write-Host ""
Write-Host "Inspect: Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "Run now: Start-ScheduledTask -TaskName '$TaskName'"
