# Summarize Extension - New PC Setup Guide

## Prerequisites
- **Node.js 22+** installed
- **Git** installed
- **Chrome** with the Summarize extension installed from Chrome Web Store
- **GitHub CLI** (`gh`) installed and authenticated

## Step 1: Install CLI from your fork

```powershell
# Clone your fork (has the thinking model + timeout fixes)
cd ~\Documents
gh repo clone francescocan/summarize

# Install globally from the fork
cd summarize
npm install
npm run build
npm link
```

Or, if you prefer installing from npm first and then patching:

```powershell
# Install the official version
npm i -g @steipete/summarize

# Then clone your fork and copy the patched built files over the installed ones:
gh repo clone francescocan/summarize ~\Documents\summarize
cd ~\Documents\summarize && npm install && npm run build
# Copy patched dist files over the npm-installed ones:
copy dist\esm\llm\providers\google.js "%APPDATA%\npm\node_modules\@steipete\summarize\dist\esm\llm\providers\google.js"
copy dist\esm\llm\generate-text.js "%APPDATA%\npm\node_modules\@steipete\summarize\dist\esm\llm\generate-text.js"
```

## Step 2: Get the extension token

1. Open Chrome, click the Summarize extension icon
2. Go to **Settings** (gear icon)
3. Scroll to **Local Daemon** section
4. Copy the **token** shown there

## Step 3: Install the daemon

```powershell
summarize daemon install --token <PASTE_TOKEN_HERE>
```

> Note: This will prompt for admin (UAC) to create a Windows Scheduled Task.

## Step 4: Create the .env file for API keys

Create `%USERPROFILE%\.summarize\.env` with your API keys:

```
GEMINI_API_KEY=<YOUR_GEMINI_API_KEY>
OPENAI_API_KEY=<YOUR_NVIDIA_API_KEY>
OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1
```

This file lives **outside** the git repo, so your keys are never at risk of being pushed.

## Step 5: Update daemon.cmd

Edit `%USERPROFILE%\.summarize\daemon.cmd` to load keys from .env and add `--experimental-sqlite`:

```cmd
@echo off
rem Load API keys from .env file (keeps keys out of any repo)
for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0.env") do set "%%A=%%B"
"C:\Program Files\nodejs\node.exe" --experimental-sqlite "%APPDATA%\npm\node_modules\@steipete\summarize\dist\cli.js" daemon run
```

## Step 6: Update daemon.json

Edit `%USERPROFILE%\.summarize\daemon.json` and add the env keys:

```json
{
  "version": 1,
  "token": "<YOUR_TOKEN>",
  "port": 8787,
  "env": {
    "GEMINI_API_KEY": "<YOUR_GEMINI_API_KEY>",
    "OPENAI_API_KEY": "<YOUR_NVIDIA_API_KEY>",
    "OPENAI_BASE_URL": "https://integrate.api.nvidia.com/v1"
  },
  "installedAt": "<KEEP_ORIGINAL>"
}
```

## Step 7: Create hidden-window launcher (optional)

Create `%USERPROFILE%\.summarize\daemon.vbs`:

```vbs
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run Chr(34) & "C:\Users\<USERNAME>\.summarize\daemon.cmd" & Chr(34), 0, False
```

Replace `<USERNAME>` with your Windows username.

## Step 8: Set default model

Edit `%USERPROFILE%\.summarize\config.json`:

```json
{
  "model": "google/gemini-3-flash-preview",
  "timeout": "5m"
}
```

## Step 9: Restart daemon

```powershell
# Kill existing daemon
taskkill /F /IM node.exe 2>$null

# Start hidden (via VBS)
wscript "%USERPROFILE%\.summarize\daemon.vbs"

# Verify
summarize daemon status
```

## Available Models

| Model | ID for extension settings |
|-------|--------------------------|
| Gemini 3 Flash Preview (thinking) | `google/gemini-3-flash-preview` |
| Gemini 2.5 Flash | `google/gemini-2.5-flash` |
| Kimi K2.5 via NVIDIA | `openai/moonshotai/kimi-k2.5` |

## What the patches fix

1. **google.ts**: Enables `thinking: { enabled: true }` for Google reasoning models so they don't return empty responses
2. **generate-text.ts**: Extends timeout to minimum 5 minutes for Google thinking models and OpenAI-compatible endpoints (NVIDIA free tier is slow)
