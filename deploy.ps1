# ALDIA APP - deploy.ps1
# Uso: powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -mensaje "descripcion"

param(
    [string]$mensaje = "deploy: actualizacion"
)

Write-Host "AlDia App - Deploy automatico" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Leer version actual
$html = Get-Content "index.html" -Raw
if ($html -match 'v=(\d+\.\d+\.\d+)') {
    $ver = $Matches[1]
    $parts = $ver.Split(".")
    $patch = [int]$parts[2] + 1
    $newVer = $parts[0] + "." + $parts[1] + "." + $patch
} else {
    $ver = "1.0.6"
    $newVer = "1.0.7"
}

Write-Host "Version: $ver -> $newVer" -ForegroundColor Yellow

# Actualizar version en archivos
(Get-Content "index.html" -Raw) -replace "v=$ver", "v=$newVer" | Set-Content "index.html" -NoNewline
(Get-Content "admin.html" -Raw) -replace "v=$ver", "v=$newVer" | Set-Content "admin.html" -NoNewline
(Get-Content "sw.js" -Raw) -replace $ver.Replace(".", "\."), $newVer | Set-Content "sw.js" -NoNewline

Write-Host "Archivos actualizados con v=$newVer" -ForegroundColor Green

# Git
Write-Host "Subiendo a GitHub..." -ForegroundColor Yellow
git add .
git commit -m "$mensaje (v$newVer)"
git push

# Firebase
Write-Host "Desplegando en Firebase..." -ForegroundColor Yellow
firebase deploy --only hosting

Write-Host ""
Write-Host "Deploy completado! v$newVer" -ForegroundColor Green
