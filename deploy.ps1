# ═══════════════════════════════════════════════════
#  ALDIA APP — deploy.ps1
#  Ejecutar desde PowerShell en la carpeta boletas:
#  .\deploy.ps1
#
#  Hace todo automático:
#  1. Sube la versión en HTML, CSS y SW
#  2. Git add + commit + push
#  3. Firebase deploy
# ═══════════════════════════════════════════════════

param(
    [string]$mensaje = "deploy: actualizacion"
)

Write-Host "AlDia App — Deploy automatico" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 1. Leer version actual del index.html
$html = Get-Content "index.html" -Raw
if ($html -match 'v=(\d+\.\d+\.\d+)') {
    $ver = $Matches[1]
    $parts = $ver.Split(".")
    $patch = [int]$parts[2] + 1
    $newVer = "$($parts[0]).$($parts[1]).$patch"
} else {
    $newVer = "1.0.1"
}

Write-Host "Version: $ver -> $newVer" -ForegroundColor Yellow

# 2. Reemplazar version en index.html
(Get-Content "index.html" -Raw) -replace "v=$ver", "v=$newVer" | Set-Content "index.html" -NoNewline

# 3. Reemplazar version en admin.html
(Get-Content "admin.html" -Raw) -replace "v=$ver", "v=$newVer" | Set-Content "admin.html" -NoNewline

# 4. Reemplazar version en sw.js
(Get-Content "sw.js" -Raw) -replace $ver.Replace(".", "\."), $newVer | Set-Content "sw.js" -NoNewline

Write-Host "Archivos actualizados con v=$newVer" -ForegroundColor Green

# 5. Git
Write-Host "Subiendo a GitHub..." -ForegroundColor Yellow
git add .
git commit -m "$mensaje (v$newVer)"
git push

# 6. Firebase
Write-Host "Desplegando en Firebase..." -ForegroundColor Yellow
firebase deploy --only hosting

Write-Host "" 
Write-Host "Deploy completado! v$newVer" -ForegroundColor Green
Write-Host "URL: https://aldia-app1.web.app" -ForegroundColor Cyan
