# Summarize Extension - Automated Setup Script
# Run this in PowerShell on a new PC after installing Node 22+, Git, and Chrome
# Usage: powershell -ExecutionPolicy Bypass -File setup-pc.ps1 -Token "<YOUR_TOKEN>"

param(
    [Parameter(Mandatory=$true)]
    [string]$Token,

    [Parameter(Mandatory=$true)]
    [string]$GeminiKey,
    [Parameter(Mandatory=$true)]
    [string]$NvidiaKey,
    [string]$NvidiaBaseUrl = "https://integrate.api.nvidia.com/v1",
    [string]$DefaultModel = "google/gemini-3-flash-preview"
)

$ErrorActionPreference = "Stop"
$summarizeDir = "$env:USERPROFILE\.summarize"
$npmModules = "$env:APPDATA\npm\node_modules\@steipete\summarize"
$nodeExe = "C:\Program Files\nodejs\node.exe"

Write-Host "=== Summarize Extension Setup ===" -ForegroundColor Cyan

# Step 1: Check Node version
$nodeVersion = (node --version) -replace 'v',''
$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 22) {
    Write-Host "ERROR: Node.js 22+ required. Current: v$nodeVersion" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js v$nodeVersion" -ForegroundColor Green

# Step 2: Install from npm
Write-Host "`nInstalling @steipete/summarize globally..." -ForegroundColor Yellow
npm i -g @steipete/summarize
Write-Host "[OK] Installed" -ForegroundColor Green

# Step 3: Install daemon (creates Scheduled Task - needs admin)
Write-Host "`nInstalling daemon with token..." -ForegroundColor Yellow
& "$nodeExe" --experimental-sqlite "$npmModules\dist\cli.js" daemon install --token $Token
Write-Host "[OK] Daemon installed" -ForegroundColor Green

# Step 4: Patch daemon.cmd with env vars and --experimental-sqlite
$daemonCmd = @"
@echo off
set GEMINI_API_KEY=$GeminiKey
set OPENAI_API_KEY=$NvidiaKey
set OPENAI_BASE_URL=$NvidiaBaseUrl
"$nodeExe" --experimental-sqlite "$npmModules\dist\cli.js" daemon run
"@
Set-Content -Path "$summarizeDir\daemon.cmd" -Value $daemonCmd -Encoding ASCII
Write-Host "[OK] daemon.cmd patched" -ForegroundColor Green

# Step 5: Update daemon.json with env vars
$daemonJson = Get-Content "$summarizeDir\daemon.json" -Raw | ConvertFrom-Json
$daemonJson.env = @{
    GEMINI_API_KEY = $GeminiKey
    OPENAI_API_KEY = $NvidiaKey
    OPENAI_BASE_URL = $NvidiaBaseUrl
}
$daemonJson | ConvertTo-Json -Depth 10 | Set-Content "$summarizeDir\daemon.json" -Encoding UTF8
Write-Host "[OK] daemon.json patched" -ForegroundColor Green

# Step 6: Create hidden-window VBS launcher
$vbs = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run Chr(34) & "$summarizeDir\daemon.cmd" & Chr(34), 0, False
"@
Set-Content -Path "$summarizeDir\daemon.vbs" -Value $vbs -Encoding ASCII
Write-Host "[OK] daemon.vbs created" -ForegroundColor Green

# Step 7: Set default model config
$config = @{
    model = $DefaultModel
    timeout = "5m"
} | ConvertTo-Json
Set-Content -Path "$summarizeDir\config.json" -Value $config -Encoding UTF8
Write-Host "[OK] config.json set to $DefaultModel" -ForegroundColor Green

# Step 8: Apply source code patches from fork
Write-Host "`nCloning fork to apply patches..." -ForegroundColor Yellow
$forkDir = "$env:USERPROFILE\Documents\summarize"
if (Test-Path $forkDir) {
    Write-Host "Fork already cloned at $forkDir, pulling latest..." -ForegroundColor Yellow
    git -C $forkDir pull
} else {
    gh repo clone francescocan/summarize $forkDir
}

# Build the fork and copy patched files
Push-Location $forkDir
npm install
npm run build
Copy-Item "dist\esm\llm\providers\google.js" "$npmModules\dist\esm\llm\providers\google.js" -Force
Copy-Item "dist\esm\llm\providers\google.js.map" "$npmModules\dist\esm\llm\providers\google.js.map" -Force -ErrorAction SilentlyContinue
Copy-Item "dist\esm\llm\generate-text.js" "$npmModules\dist\esm\llm\generate-text.js" -Force
Copy-Item "dist\esm\llm\generate-text.js.map" "$npmModules\dist\esm\llm\generate-text.js.map" -Force -ErrorAction SilentlyContinue
Pop-Location
Write-Host "[OK] Patched files copied" -ForegroundColor Green

# Step 9: Start daemon hidden
Write-Host "`nStarting daemon..." -ForegroundColor Yellow
Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
wscript "$summarizeDir\daemon.vbs"
Start-Sleep -Seconds 3

# Step 10: Verify
Write-Host "`nVerifying daemon status..." -ForegroundColor Yellow
& "$nodeExe" --experimental-sqlite "$npmModules\dist\cli.js" daemon status

Write-Host "`n=== Setup Complete ===" -ForegroundColor Cyan
Write-Host "Available models:" -ForegroundColor White
Write-Host "  - google/gemini-3-flash-preview  (thinking model, default)" -ForegroundColor White
Write-Host "  - google/gemini-2.5-flash         (fast)" -ForegroundColor White
Write-Host "  - openai/moonshotai/kimi-k2.5     (Kimi via NVIDIA)" -ForegroundColor White
