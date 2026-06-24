# Scalpatron — Stop Backend + Frontend
Write-Host "=== Scalpatron stoppen ===" -ForegroundColor Cyan
Write-Host ""

$stopped = $false

# 1) Zuerst per gespeicherter PID-Datei
$pidFile = Join-Path $env:TEMP "scalpatron-dev.json"
if (Test-Path $pidFile) {
    $data = Get-Content $pidFile | ConvertFrom-Json
    foreach ($p in @($data.BackendPID, $data.FrontendPID)) {
        if ($p) {
            $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "Stoppe PID $p ($($proc.ProcessName))..." -ForegroundColor Yellow
                taskkill /PID $p /F /T | Out-Null
                $stopped = $true
            }
        }
    }
    Remove-Item $pidFile
}

# 2) Fallback: per Port (falls start-dev.ps1 nicht genutzt wurde)
foreach ($port in @(3000, 5173)) {
    $lines = netstat -ano | Select-String "LISTENING" | Select-String ":$port\s"
    foreach ($line in $lines) {
        $pid = ($line -split '\s+')[-1]
        if ($pid -match '^\d+$' -and $pid -ne '0') {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "Stoppe PID $pid auf Port $port ($($proc.ProcessName))..." -ForegroundColor Yellow
                taskkill /PID $pid /F /T | Out-Null
                $stopped = $true
            }
        }
    }
}

Write-Host ""
if ($stopped) {
    Write-Host "Scalpatron gestoppt." -ForegroundColor Green
} else {
    Write-Host "Keine laufenden Scalpatron-Prozesse gefunden." -ForegroundColor DarkGray
}
