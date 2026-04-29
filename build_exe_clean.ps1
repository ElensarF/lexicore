$ErrorActionPreference = "Stop"

function Fail($message) {
  Write-Host ""
  Write-Host $message -ForegroundColor Red
  Write-Host ""
  exit 1
}

$root = $PSScriptRoot
Set-Location $root

if (-not (Test-Path ".\package.json")) { Fail "package.json bulunamadi. Scripti proje kok dizininde calistirin." }
if (-not (Test-Path ".\LexiCore.spec")) { Fail "LexiCore.spec bulunamadi. Scripti proje kok dizininde calistirin." }
if (-not (Test-Path ".\backend\requirements.txt")) { Fail "backend\requirements.txt bulunamadi." }

Write-Host "Node/pnpm kontrol ediliyor..." -ForegroundColor Cyan

try { $null = Get-Command node -ErrorAction Stop } catch { Fail "node bulunamadi. Once Node.js LTS kurun ve yeniden deneyin." }
try { $null = Get-Command npm -ErrorAction Stop } catch { Fail "npm bulunamadi. Node.js kurulumunu kontrol edin." }

try {
  $null = Get-Command pnpm -ErrorAction Stop
} catch {
  Write-Host "pnpm bulunamadi. Kurulum deneniyor (corepack)..." -ForegroundColor Yellow
  try {
    & corepack enable | Out-Null
    & corepack prepare pnpm@latest --activate | Out-Null
  } catch {
    Write-Host "corepack ile olmadi. npm -g ile deneniyor..." -ForegroundColor Yellow
    & npm i -g pnpm | Out-Null
  }
  try { $null = Get-Command pnpm -ErrorAction Stop } catch { Fail "pnpm kurulumu basarisiz. Node.js kurulumunu/PATH'i kontrol edin." }
}

Write-Host "Frontend: pnpm install + build" -ForegroundColor Cyan
& pnpm install
& pnpm run build

Write-Host "Python sanal ortam olusturuluyor..." -ForegroundColor Cyan
& python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
& .\.venv\Scripts\python.exe -m pip install pyinstaller

Write-Host "Temizleme: build/ ve dist/LexiCore" -ForegroundColor Cyan
if (Test-Path ".\build") { Remove-Item -Recurse -Force ".\build" }
if (Test-Path ".\dist\LexiCore") { Remove-Item -Recurse -Force ".\dist\LexiCore" }

Write-Host "EXE uretiliyor: PyInstaller" -ForegroundColor Cyan
& .\.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean .\LexiCore.spec

if (Test-Path ".\dist\LexiCore\LexiCore.exe") {
  Write-Host ""
  Write-Host "Hazir: dist\LexiCore\LexiCore.exe" -ForegroundColor Green
  Write-Host ""
  exit 0
}

Write-Host ""
Write-Host "Build tamamlandi ama LexiCore.exe bulunamadi. dist klasorunu kontrol edin." -ForegroundColor Yellow
Write-Host ""
exit 0

