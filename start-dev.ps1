# Scalpatron — Start Backend + Frontend
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== Scalpatron Dev Server ===" -ForegroundColor Cyan
Write-Host ""

# Backend
Write-Host "Starting Backend  (port 3000)..." -ForegroundColor Yellow
$backend = Start-Process powershell.exe `
    -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; npx tsx src/index.ts" `
    -PassThru

Start-Sleep -Milliseconds 300

# Frontend
Write-Host "Starting Frontend (port 5173)..." -ForegroundColor Yellow
$frontend = Start-Process powershell.exe `
    -ArgumentList "-NoExit", "-Command", "Set-Location '$root\frontend'; npm run dev" `
    -PassThru

# PIDs speichern damit stop-dev.ps1 sie findet
$pidFile = Join-Path $env:TEMP "scalpatron-dev.json"
@{
    BackendPID  = $backend.Id
    FrontendPID = $frontend.Id
    StartedAt   = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content $pidFile -Encoding utf8

Write-Host ""
Write-Host "Backend  PID : $($backend.Id)"  -ForegroundColor Green
Write-Host "Frontend PID : $($frontend.Id)" -ForegroundColor Green
Write-Host ""
Write-Host "http://localhost:3000  (API)"      -ForegroundColor Cyan
Write-Host "http://localhost:5173  (Frontend)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Zum Stoppen: .\stop-dev.ps1" -ForegroundColor DarkGray
