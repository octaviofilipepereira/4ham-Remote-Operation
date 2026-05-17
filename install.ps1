#Requires -Version 5.1
# © 2026 Octávio Filipe Gonçalves — CT7BFV
# License: GNU GPL-3.0
#
# 4ham Remote Operation — Windows Installer
#
# Pré-requisitos mínimos:
#   - Windows 10/11 (64-bit)
#   - Python 3.11+ instalado (https://python.org) e no PATH
#   - PowerShell 5.1+ (incluído no Windows 10/11)
#
# Uso (PowerShell como Administrador):
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\install.ps1

param(
    [switch]$SkipWsjtx,
    [switch]$SkipHamlib,
    [switch]$SkipCerts
)

$ErrorActionPreference = "Stop"
$RootDir   = $PSScriptRoot
$VenvDir   = Join-Path $RootDir ".venv"
$LogFile   = Join-Path $env:TEMP "4ham-remote-install-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

# ── helpers ────────────────────────────────────────────────────────────────────
function Write-Info  { param($msg) Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "[ERRO]  $msg" -ForegroundColor Red; exit 1 }

function Invoke-Logged {
    param([string]$Cmd, [string[]]$Args)
    $result = & $Cmd @Args 2>&1
    $result | Out-File -Append -FilePath $LogFile
    return $result
}

# ── verificar Python ───────────────────────────────────────────────────────────
function Test-Python {
    Write-Info "A verificar Python..."
    try {
        $ver = & python --version 2>&1
        if ($ver -match "Python (\d+)\.(\d+)") {
            $major = [int]$Matches[1]; $minor = [int]$Matches[2]
            if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 11)) {
                Write-Fail "Python 3.11+ necessário. Instalado: $ver"
            }
            Write-Ok "$ver encontrado."
        } else {
            Write-Fail "Python não encontrado no PATH. Instalar em https://python.org"
        }
    } catch {
        Write-Fail "Python não encontrado no PATH. Instalar em https://python.org"
    }
}

# ── Hamlib (rigctld.exe) ───────────────────────────────────────────────────────
function Install-Hamlib {
    if ($SkipHamlib) { Write-Warn "Hamlib ignorado (--SkipHamlib)."; return }
    if (Get-Command rigctld -ErrorAction SilentlyContinue) {
        Write-Ok "rigctld já disponível no PATH."
        return
    }
    Write-Info "rigctld não encontrado no PATH."
    Write-Warn "Descarregar Hamlib para Windows em: https://github.com/Hamlib/Hamlib/releases"
    Write-Warn "Instalar e adicionar ao PATH, depois correr: rigctld --version"
    Write-Warn "A continuar sem Hamlib — adicionar ao PATH antes de iniciar o backend."
}

# ── WSJT-X (jt9.exe + wsprd.exe) — opcional, R3 ──────────────────────────────
function Install-Wsjtx {
    if ($SkipWsjtx) { Write-Warn "WSJT-X ignorado (--SkipWsjtx)."; return }
    if (Get-Command jt9 -ErrorAction SilentlyContinue) {
        Write-Ok "jt9 já disponível no PATH."
        return
    }
    Write-Info "jt9 não encontrado — necessário para FT8/FT4/WSPR (fase R3)."
    Write-Warn "Descarregar WSJT-X em: https://wsjt.sourceforge.io/wsjtx.html"
    Write-Warn "Após instalar, adicionar a pasta C:\WSJT\wsjtx\bin ao PATH."
}

# ── venv Python ───────────────────────────────────────────────────────────────
function New-Venv {
    if (Test-Path $VenvDir) {
        Write-Warn "venv já existe em $VenvDir — a reutilizar."
    } else {
        Write-Info "A criar venv em $VenvDir..."
        Invoke-Logged python @("-m", "venv", $VenvDir) | Out-Null
        Write-Ok "venv criado."
    }
}

function Install-PythonDeps {
    Write-Info "A instalar dependências Python (pode demorar)..."
    $pip  = Join-Path $VenvDir "Scripts\pip.exe"
    $reqs = Join-Path $RootDir "backend\requirements.txt"
    Invoke-Logged $pip @("install", "--upgrade", "pip", "setuptools", "wheel") | Out-Null
    Invoke-Logged $pip @("install", "-r", $reqs) | Out-Null
    Write-Ok "Dependências Python instaladas."
}

# ── configuração ───────────────────────────────────────────────────────────────
function Setup-Config {
    $cfg     = Join-Path $RootDir "config\remote_config.yaml"
    $example = Join-Path $RootDir "config\remote_config.example.yaml"
    if (Test-Path $cfg) {
        Write-Warn "Config já existe: $cfg — não substituída."
    } else {
        Copy-Item $example $cfg
        Write-Ok "Config copiada para $cfg — editar antes de iniciar."
    }
}

# ── certificados TLS ───────────────────────────────────────────────────────────
function Setup-Certs {
    # SSL removido — servidor corre em HTTP simples
    Write-Warn "SSL desactivado — a correr em HTTP."
}

# ── script de arranque ─────────────────────────────────────────────────────────
function New-RunScript {
    $runBat = Join-Path $RootDir "run.bat"
    $uvicorn = Join-Path $VenvDir "Scripts\uvicorn.exe"
    $content = @"
@echo off
REM 4ham Remote Operation — arranque rapido (desenvolvimento)
set REMOTE_CONFIG=%~dp0config\remote_config.yaml
"$uvicorn" backend.app.main:app ^
    --host 0.0.0.0 --port 8001 ^
    --reload
"@
    $content | Out-File -Encoding ASCII -FilePath $runBat
    Write-Ok "Script de arranque criado: run.bat"
}

# ── audio_bridge.py (Windows TX) ──────────────────────────────────────────────
function Check-AudioBridge {
    $ab = Join-Path $RootDir "audio_bridge\audio_bridge.py"
    if (Test-Path $ab) {
        Write-Ok "audio_bridge.py presente (necessário para TX em R2)."
    } else {
        Write-Warn "audio_bridge\audio_bridge.py não encontrado — necessário para TX (R2)."
    }
}

# ── sumário ────────────────────────────────────────────────────────────────────
function Write-Summary {
    Write-Host ""
    Write-Host "══════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  4ham Remote Operation — instalação concluída" -ForegroundColor Green
    Write-Host "══════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Config:    $RootDir\config\remote_config.yaml"
    Write-Host "  Certs:     $RootDir\certs\"
    Write-Host "  Log inst:  $LogFile"
    Write-Host ""
    Write-Host "  Arranque rápido (dev):"
    Write-Host "    .\run.bat" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Importante: editar config\remote_config.yaml antes de iniciar." -ForegroundColor Yellow
    Write-Host "  Password:   python scripts\hash_password.py <password>"          -ForegroundColor Yellow
    Write-Host ""
}

# ── main ───────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  4ham Remote Operation — Installer     " -ForegroundColor Cyan
Write-Host "  CT7BFV — Octávio Filipe Pereira        " -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Start-Transcript -Path $LogFile -Append | Out-Null

Test-Python
Install-Hamlib
Install-Wsjtx
New-Venv
Install-PythonDeps
Setup-Config
Setup-Certs
New-RunScript
Check-AudioBridge
Write-Summary

Stop-Transcript | Out-Null
