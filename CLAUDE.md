# Summarize - Project Context for Claude

## What This Is
A fork of [@steipete/summarize](https://github.com/nichochar/summarize) — a tool that summarizes web pages. It has:
- A **CLI + daemon** (Node/TypeScript) running on `http://127.0.0.1:8787`
- A **Chrome extension** (sidepanel) that talks to the daemon
- A **chat feature** that lets you ask questions about any page via an AI agent

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

After building the daemon, copy dist files to the npm global location:
```bash
# Find install path
npm list -g @steipete/summarize
# Copy dist/ folder there
```

After building the extension, reload in `chrome://extensions`.

## Key File Paths

### Daemon (Node server)
- `src/daemon/server.ts` — HTTP server, routes, SSE streaming
- `src/daemon/agent.ts` — `/v1/agent` handler, LLM calls for chat
- `src/daemon/chat.ts` — Chat history management
- `src/daemon/config.ts` — Daemon configuration
- `src/llm/generate-text.ts` — LLM API calls (Google, OpenAI, etc.)
- `src/llm/google.ts` — Google Gemini provider (thinking mode support)

### Chrome Extension
- `apps/chrome-extension/src/entrypoints/background.ts` — Background service worker (message routing, daemon communication, SSE handling)
- `apps/chrome-extension/src/entrypoints/sidepanel/main.ts` — Sidepanel UI logic (chat, summaries, tab switching)
- `apps/chrome-extension/src/entrypoints/sidepanel/panel-cache.ts` — Panel state cache (URL-keyed)
- `apps/chrome-extension/src/lib/extension-logs.ts` — Extension logging (`logExtensionEvent`)
- `apps/chrome-extension/src/lib/agent-response.ts` — SSE response reader
- `apps/chrome-extension/src/lib/sse.ts` — SSE stream parser

### Config Files
- `~/.summarize/daemon.json` — Daemon token and port config
- `~/.summarize/.env` — API keys (GOOGLE_GENERATIVE_AI_API_KEY, etc.)
- `~/.summarize/config.json` — User settings

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

## Gotchas
- Read `LESSONS.md` skill for debugging history and known pitfalls
- The `send()` function in background.ts has an `isPanelOpen()` gate — agent messages bypass it
- `panel:ready` fires on visibility change (not just initial open) — don't put destructive resets there
- Chrome MV3 service workers can sleep — keep-alive is maintained by active SSE fetch connections
- The daemon SSE uses keepalive comments (`: keepalive`) that must be skipped in the stream parser
