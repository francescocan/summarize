# Summarize - Project Context for Claude

## What This Is
A fork of [@steipete/summarize](https://github.com/nichochar/summarize) — a tool that summarizes web pages. It has:
- A **CLI + daemon** (Node/TypeScript) running on `http://127.0.0.1:8787`
- A **Chrome extension** (sidepanel) that talks to the daemon
- A **chat feature** that lets you ask questions about any page via an AI agent
- A **Deep Analysis mode** — multi-phase tutorial deconstruction with optional Gemini Grounding research

Fork repo: `francescocan/summarize`

## Build Commands

```bash
# Build daemon (from repo root)
pnpm run build

# Build Chrome extension only
pnpm run build -C apps/chrome-extension
# or:
cd apps/chrome-extension && pnpm run build

# Run tests
pnpm test

# Lint
pnpm lint
```

After building the daemon, restart it:
```bash
# On Windows (admin PowerShell):
summarize daemon install --token <TOKEN_FROM_EXTENSION>
# or restart existing:
summarize daemon restart
```

**IMPORTANT**: On Node 22.x, the daemon requires `--experimental-sqlite`. The `daemon.cmd` at `~/.summarize/daemon.cmd` must include this flag. If the daemon crashes with "No such built-in module: node:sqlite", add `--experimental-sqlite` to the node invocation in `daemon.cmd`.

After building the extension, reload in `chrome://extensions`. The extension output is at `apps/chrome-extension/.output/chrome-mv3`.

## Key File Paths

### Core Package (`packages/core/`)
- `src/prompts/summary-system.ts` — `SUMMARY_SYSTEM_PROMPT` (standard summarization system prompt)
- `src/prompts/deep-analysis-system.ts` — `DEEP_ANALYSIS_SYSTEM_PROMPT` + `buildDeepAnalysisPrompt()` (deep analysis mode)
- `src/prompts/link-summary.ts` — `buildLinkSummaryPrompt()` (standard user prompt builder)
- `src/prompts/format.ts` — `buildTaggedPrompt()`, `buildInstructions()` — XML-tagged prompt structure (`<instructions>`, `<context>`, `<content>`)
- `src/prompts/summary-lengths.ts` — Length presets (short/medium/long/xl/xxl)
- `src/prompts/index.ts` — Barrel export for all prompts
- `src/shared/contracts.ts` — Shared types including `AnalysisMode`
- `src/index.ts` — Public API exports

### Daemon (Node server)
- `src/daemon/server.ts` — HTTP server, routes (`/v1/summarize`, `/v1/agent`), SSE streaming. Parses `analysisMode` and `grounding` from request bodies
- `src/daemon/summarize.ts` — `streamSummaryForUrl()` and `streamSummaryForVisiblePage()`. Passes `analysisMode` through to `runUrlFlow()`
- `src/daemon/agent.ts` — `/v1/agent` handler, LLM calls for chat. Supports `grounding` flag for Gemini web search
- `src/daemon/chat.ts` — Chat history management
- `src/daemon/config.ts` — Daemon configuration
- `src/daemon/flow-context.ts` — `createDaemonUrlFlowContext()` — builds the UrlFlowContext used by runUrlFlow
- `src/run/flows/url/flow.ts` — `runUrlFlow()` — the main URL extraction + summarization pipeline. Accepts `analysisMode` to branch between standard and deep analysis prompts
- `src/run/flows/url/summary.ts` — `summarizeExtractedUrl()` — sends prompt to LLM. Accepts `systemPromptOverride` to swap the system prompt
- `src/llm/providers/google.ts` — Google Gemini provider; includes `completeGoogleWithGrounding()` for Gemini API with `google_search_retrieval`

### Chrome Extension
- `apps/chrome-extension/src/entrypoints/background.ts` — Background service worker (message routing, daemon communication, SSE handling). Forwards `analysisMode` to daemon, `grounding` to agent
- `apps/chrome-extension/src/entrypoints/sidepanel/main.ts` — Sidepanel UI logic (chat, summaries, tab switching, analysis mode toggle state)
- `apps/chrome-extension/src/entrypoints/sidepanel/pickers.tsx` — Preact UI components for controls including the Summary/Deep Analysis toggle
- `apps/chrome-extension/src/entrypoints/sidepanel/style.css` — Styles including `.analysisModeToggle`
- `apps/chrome-extension/src/lib/settings.ts` — Settings type with `analysisMode`, persisted to `chrome.storage.local`
- `apps/chrome-extension/src/lib/daemon-payload.ts` — `buildSummarizeRequestBody()` — constructs the HTTP body for `/v1/summarize`, includes `analysisMode`
- `apps/chrome-extension/src/lib/token.ts` — `generateToken()` — the extension generates the auth token, NOT the daemon
- `apps/chrome-extension/src/entrypoints/sidepanel/panel-cache.ts` — Panel state cache (URL-keyed)
- `apps/chrome-extension/src/lib/extension-logs.ts` — Extension logging (`logExtensionEvent`)
- `apps/chrome-extension/src/lib/agent-response.ts` — SSE response reader
- `apps/chrome-extension/src/lib/sse.ts` — SSE stream parser

### Config Files
- `~/.summarize/daemon.json` — Daemon token, port, and env (API keys). Written by `daemon install`
- `~/.summarize/daemon.cmd` — Windows startup script for Scheduled Task. Must include `--experimental-sqlite` for Node 22.x
- `~/.summarize/.env` — API keys (GEMINI_API_KEY, OPENAI_API_KEY, etc.)
- `~/.summarize/config.json` — User settings

## Architecture: Summarization Flow

### Two Summarization Modes
1. **Summary** (default) — uses `SUMMARY_SYSTEM_PROMPT` + `buildLinkSummaryPrompt()`
2. **Deep Analysis** — uses `DEEP_ANALYSIS_SYSTEM_PROMPT` + `buildDeepAnalysisPrompt()` — 4-phase analysis:
   - Phase 1: Contextual Grounding (identify what the tutorial covers)
   - Phase 2: Deconstruction (break down into components)
   - Phase 3: Step-by-Step Blueprint (actionable instructions)
   - Phase 4: Critical Diagnostic with Research Proposals (identify gaps, suggest web searches)

### Prompt Structure
All prompts use XML-tagged format built by `buildTaggedPrompt()`:
```
<instructions>...</instructions>
<context>url, title, siteName, etc.</context>
<content>page text or transcript</content>
```

### Data Flow: Extension → Daemon → LLM

```
Sidepanel (main.ts)           Background (background.ts)         Daemon
      |                              |                              |
      |-- panel:summarize ---------->|                              |
      |   {analysisMode}             |                              |
      |                              |-- buildSummarizeRequestBody  |
      |                              |   {analysisMode in body}     |
      |                              |-- POST /v1/summarize ------->|
      |                              |                              |-- server.ts: parse analysisMode
      |                              |                              |-- summarize.ts: streamSummaryForUrl()
      |                              |                              |-- flow.ts: runUrlFlow({analysisMode})
      |                              |                              |   if deep-analysis:
      |                              |                              |     buildDeepAnalysisPrompt()
      |                              |                              |     systemPromptOverride = DEEP_ANALYSIS_SYSTEM_PROMPT
      |                              |                              |   else:
      |                              |                              |     buildUrlPrompt()
      |                              |                              |-- summary.ts: summarizeExtractedUrl()
      |                              |                              |   uses systemPromptOverride ?? SUMMARY_SYSTEM_PROMPT
      |                              |                              |-- LLM call via pi-ai library
      |                              |<--- SSE stream --------------|
      |<--- run:chunk ---------------|                              |
```

### Chat with Gemini Grounding (Research)

When deep analysis is active, the chat agent can perform web research:
```
Sidepanel                    Background                     Daemon (agent.ts)
      |                              |                              |
      |-- panel:agent ------------->|                              |
      |   {grounding: true}         |                              |
      |                              |-- POST /v1/agent ---------->|
      |                              |   {grounding: true}         |-- if grounding:
      |                              |                              |   force model = gemini-2.0-flash
      |                              |                              |   completeGoogleWithGrounding()
      |                              |                              |   (Gemini v1beta + google_search_retrieval)
      |                              |<--- SSE response ------------|
      |<--- agent:response ---------|                              |
```

The LLM first suggests research topics in Phase 4, asks the user to approve, then uses Gemini Grounding to search the web.

## Architecture: Chat Message Flow

```
Sidepanel (main.ts)                Background (background.ts)           Daemon (server.ts)
      |                                    |                                  |
      |-- panel:agent {requestId} -------->|                                  |
      |                                    |-- POST /v1/agent (SSE) --------->|
      |                                    |                                  |-- LLM call
      |                                    |<--- SSE: event:chunk ------------|
      |<--- agent:chunk {requestId} -------|                                  |
      |                                    |<--- SSE: event:assistant --------|
      |<--- agent:response {requestId} ----|                                  |
```

### Key Maps in main.ts (sidepanel)
- `pendingAgentRequests` — Map<requestId, {resolve, reject, onChunk}> — active UI handlers
- `backgroundAgentRequests` — Map<requestId, {url, userMessages, accumulatedContent}> — tracks requests that should persist after tab switch
- `chatHistoryCache` — Map<url, ChatMessage[]> — URL-keyed chat history

### Key State in background.ts
- `panelSessions` — Map<windowId, PanelSession> — one session per browser window
- `session.agentControllers` — Map<requestId, AbortController> — per-request HTTP abort controllers
- `send(session, msg)` — sends message to sidepanel port; bypasses `isPanelOpen()` for agent messages

## Important Patterns

### Token Flow
The **extension generates the token** (via `generateToken()` in `lib/token.ts`), stores it in `chrome.storage.local`, and displays the `summarize daemon install --token <TOKEN>` command for the user to run. The daemon then stores this token in `~/.summarize/daemon.json`. Both sides must match. Reloading the extension may regenerate the token — if this happens, re-run `daemon install` with the new token shown in the setup screen.

### Tab Switch Behavior (Custom)
- **No auto-summarize** on tab switch — user must explicitly request
- **Chat persists per URL** — switching tabs saves chat under the old URL, loads for new URL
- **Agent requests keep running** in background when switching tabs
- Background responses saved to chat history via `backgroundAgentRequests` map
- `panel:ready` and `panel:closed` do NOT abort agent controllers

### Error Logging
Use `logExtensionEvent()` from `lib/extension-logs.ts`:
```typescript
logExtensionEvent({
  event: 'some:event',
  level: 'error',  // 'info' | 'warn' | 'error' | 'verbose'
  detail: { key: 'value' },
  scope: 'panel:bg',  // or 'panel:chat'
})
```
Logs viewable in extension options page > Logs tab.

## Gotchas & Lessons Learned

### Build & Deploy
- The `send()` function in background.ts has an `isPanelOpen()` gate — agent messages bypass it
- `panel:ready` fires on visibility change (not just initial open) — don't put destructive resets there
- Chrome MV3 service workers can sleep — keep-alive is maintained by active SSE fetch connections
- The daemon SSE uses keepalive comments (`: keepalive`) that must be skipped in the stream parser
- On Windows, the daemon runs as a Scheduled Task. `schtasks` requires admin privileges to create/modify
- `daemon.cmd` must include `--experimental-sqlite` on Node 22.x or the daemon crashes immediately

### Two Summarization Paths (CRITICAL)
There are **two different code paths** for summarization — this is a major architectural gotcha:
1. **`streamSummaryForVisiblePage()`** — used for "visible page" mode, builds the prompt **inside** the function, then calls `summarizeExtractedUrl()`
2. **`streamSummaryForUrl()`** — used by the Chrome extension for URL mode, delegates to `runUrlFlow()` in `flow.ts` which builds the prompt internally

Any feature that changes prompt behavior (like `analysisMode`) MUST be wired through BOTH paths:
- In `streamSummaryForVisiblePage()`: branch directly before calling `summarizeExtractedUrl()`
- In `streamSummaryForUrl()`: pass through to `runUrlFlow()` which branches in `flow.ts`

Forgetting to wire `runUrlFlow()` will make the feature appear to work in tests but fail silently in the extension (it always uses URL mode).

### Prompt Architecture
- System prompt goes as `system` field in the `Prompt` object (the LLM's system message)
- User prompt goes as `userText` field (the actual user message with XML tags)
- `systemPromptOverride` in `summarizeExtractedUrl()` allows swapping the system prompt without changing the flow
- The `@steipete/summarize-core` package exports prompts via `@steipete/summarize-core/prompts` path
- `src/prompts/index.ts` (at root `src/`) re-exports from `@steipete/summarize-core/prompts`

### Extension ↔ Daemon Communication
- The extension type `PanelToBg` in `main.ts` and `background.ts` define the message shapes — keep them in sync
- `buildSummarizeRequestBody()` in `daemon-payload.ts` constructs the HTTP body — any new field must be added here
- The `raw as { field: Type }` cast pattern in `background.ts` is how fields are extracted from messages
- API keys are stored in `~/.summarize/daemon.json` under `env` (also in `~/.summarize/.env` which the daemon reads separately)

### Gemini Grounding
- Uses Gemini API `v1beta` (not v1) for `google_search_retrieval` tool support
- `completeGoogleWithGrounding()` in `google.ts` makes a raw HTTP call bypassing the `pi-ai` library (which doesn't support grounding natively)
- Requires `GEMINI_API_KEY` in daemon config
- The `grounding` flag is sent from the extension when `analysisMode === 'deep-analysis'` and the user is in chat
