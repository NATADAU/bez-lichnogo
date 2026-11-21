# Готовит локальную папку vendor/ с PDF.js 6.5.438 внутри текущей папки проекта.
# Не ставит глобальные пакеты. Запускать из корня проекта:
#   powershell -ExecutionPolicy Bypass -File .\scripts\prepare-vendor.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Установка pdfjs-dist@6.5.438 только в папку проекта..."
npm install --no-save --ignore-scripts --no-audit --no-fund pdfjs-dist@6.5.438

New-Item -ItemType Directory -Force -Path (Join-Path $root 'vendor') | Out-Null
Copy-Item (Join-Path $root 'node_modules\pdfjs-dist\build\pdf.min.mjs') (Join-Path $root 'vendor\pdf.min.mjs') -Force
Copy-Item (Join-Path $root 'node_modules\pdfjs-dist\build\pdf.worker.min.mjs') (Join-Path $root 'vendor\pdf.worker.min.mjs') -Force

$a = Get-Item (Join-Path $root 'vendor\pdf.min.mjs')
$b = Get-Item (Join-Path $root 'vendor\pdf.worker.min.mjs')
if ($a.Length -lt 1000 -or $b.Length -lt 1000) { throw 'Файлы vendor слишком малы — установка не удалась.' }

Write-Host "Готово: vendor/pdf.min.mjs ($($a.Length) байт), vendor/pdf.worker.min.mjs ($($b.Length) байт)"
Write-Host "Дальше откройте сайт через локальный сервер, например: npx --yes serve -l 4173 ."
