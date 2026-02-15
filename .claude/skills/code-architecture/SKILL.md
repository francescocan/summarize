# Code Architecture — Summarize Extension

Detailed reference for the Chrome extension's internal architecture. Consult when making changes to understand data flow and dependencies.

---

## Directory Structure

```
summarize/
  src/                          # Daemon + CLI source
    daemon/
      server.ts                 # HTTP server (port 8787), routes, SSE
      agent.ts                  # /v1/agent — chat with page context
      chat.ts                   # Chat history management
      config.ts                 # Daemon config loader
    llm/
      generate-text.ts          # LLM call abstraction (timeout, retries)
      google.ts                 # Google Gemini provider
    content/                    # Page content extraction
    cli.ts                      # CLI entry point
  apps/chrome-extension/
    src/entrypoints/
      background.ts             # Service worker (~2400 lines)
      sidepanel/
        main.ts                 # Sidepanel UI (~4500 lines)
        panel-cache.ts          # Summary cache (URL-keyed)
      content-scripts/
        extract.ts              # Page content extraction
        automation.ts           # Browser automation
        hover.ts                # Hover summaries
    src/lib/
      extension-logs.ts         # logExtensionEvent() — chrome.storage.session logs
      agent-response.ts         # SSE agent response reader
      sse.ts                    # SSE stream parser
      settings.ts               # Extension settings (chrome.storage.local)
      daemon-payload.ts         # Build request bodies for daemon
      chat-context.ts           # Build page content for chat
  packages/core/                # Shared utilities
```

---

## background.ts — Service Worker

### Session Management
```
panelSessions: Map<windowId, PanelSession>
```

Each browser window has ONE `PanelSession`:
```typescript
type PanelSession = {
  windowId: number
  port: chrome.runtime.Port       // Active connection to sidepanel
  panelOpen: boolean              // Is sidepanel visible?
  panelLastPingAt: number         // Last ping timestamp (25s interval)
  lastSummarizedUrl: string | null
  inflightUrl: string | null
  runController: AbortController | null     // Summarization abort
  agentController: AbortController | null   // Legacy single controller
  agentControllers: Map<string, AbortController>  // Per-request controllers
  lastNavAt: number
  daemonRecovery: DaemonRecovery
}
```

### Message Types

**Sidepanel -> Background (PanelToBg)**:
- `panel:ready` — Sidepanel became visible
- `panel:closed` — Sidepanel became hidden
- `panel:ping` — Keepalive (every 25s)
- `panel:summarize` — User requested summary
- `panel:agent` — Chat message {requestId, messages, tools, summary}
- `panel:agent-abort` — User explicitly cancelled chat
- `panel:cache` — Store panel cache
- `panel:get-cache` — Request cached panel state

**Background -> Sidepanel (BgToPanel)**:
- `ui:state` — Full UI state update (tab info, settings, daemon status)
- `ui:status` — Status text update
- `run:start` / `run:error` — Summarization lifecycle
- `agent:chunk` — Streaming chat text {requestId, text}
- `agent:response` — Final chat response {requestId, ok, assistant, error}
- `ui:cache` — Cached panel state response

### Critical Functions
- `send(session, msg)` — Posts message to sidepanel port. **Bypasses isPanelOpen() for agent messages.** Logs errors on failure.
- `isPanelOpen(session)` — Checks panelOpen flag + 45s ping timeout
- `emitState(session, status)` — Builds and sends full UI state (triggers tab change detection in sidepanel)
- `registerPanelSession(windowId, port)` — Creates or reuses session, updates port reference
- `handlePanelMessage(session, msg)` — Main message router (switch on msg.type)

### Agent Request Flow (background side)
1. Receives `panel:agent` with requestId
2. Creates per-request `AbortController`, stores in `session.agentControllers`
3. Builds page content from cached extract
4. POSTs to `http://127.0.0.1:8787/v1/agent` with SSE streaming
5. Iterates SSE events: sends `agent:chunk` for text, `agent:response` for final answer
6. Finally block: removes controller from map

### Tab Change Detection (background side)
- `chrome.tabs.onActivated` — Calls `emitState(session, '')` which sends `ui:state` to sidepanel
- `chrome.tabs.onUpdated` — Same for URL/title changes
- Does NOT auto-summarize on tab switch

---

## main.ts — Sidepanel

### Global State
```typescript
let activeTabId: number | null
let activeTabUrl: string | null
let panelPort: chrome.runtime.Port | null
```

### Chat State Maps
```typescript
// Active UI handlers for in-progress requests
pendingAgentRequests: Map<string, {
  resolve: (result) => void
  reject: (error) => void
  onChunk: (text: string) => void
  timer: number
}>

// Background tracking for requests that outlive tab switches
backgroundAgentRequests: Map<string, {
  url: string                    // URL the question was asked on
  userMessages: ChatMessage[]    // Snapshot of chat messages when request was made
  accumulatedContent: string     // Chunks accumulated while on different tab
}>

// Persisted chat history per URL
chatHistoryCache: Map<string, ChatMessage[]>
```

### Tab Switch Flow (sidepanel side)
`updateControls(state: UiState)` is called when `ui:state` arrives:

1. Detects `tabChanged` = `nextTabId !== activeTabId`
2. Saves current chat under OLD URL (captures `previousUrl` first)
3. Updates `activeTabId` and `activeTabUrl`
4. Detaches `pendingAgentRequests` (delete entries, don't abort)
5. Calls `resetChatState()` — clears chat UI
6. Resolves panel cache for new tab
7. Calls `restoreChatHistory()` — loads saved messages for new URL

### Agent Response Handling
`handleAgentResponse(msg)`:
1. If `pendingAgentRequests` has the requestId → normal delivery (resolve promise, update UI)
2. If only `backgroundAgentRequests` has it → background delivery (save to chatHistoryCache + chrome.storage.session)
3. Otherwise → discard

`handleAgentChunk(msg)`:
1. If `pendingAgentRequests` has it → call `onChunk` (stream to UI)
2. If `backgroundAgentRequests` has it → accumulate silently

### Chat Persistence
- `persistChatHistory(url)` — Saves to both in-memory cache and chrome.storage.session
- `restoreChatHistory()` — Loads from cache or storage for current activeTabUrl
- `getChatHistoryKey(url)` — Returns `chat:url:${url}` storage key
- `compactChatHistory(msgs, limits)` — Trims old messages to stay within limits

---

## panel-cache.ts — Summary Cache

Caches summarization results keyed by URL (not tab ID):
```typescript
buildKey(_tabId: number, url: string) => url
```

This means the same URL in different tabs shares the same summary cache.

---

## extension-logs.ts — Logging

```typescript
logExtensionEvent({
  event: string,       // e.g. 'agent:error', 'chat:tab-switch'
  level: 'info' | 'warn' | 'error' | 'verbose',
  detail?: object,     // Arbitrary data
  scope?: string,      // e.g. 'panel:bg', 'panel:chat'
})
```

Writes to `chrome.storage.session` under key `__extensionLogs`. Viewable in options page > Logs tab.

---

## Daemon Routes

- `GET /health` — Health check (no auth)
- `GET /ping` — Auth check (requires Bearer token)
- `POST /v1/summarize` — Summarize a page (SSE response)
- `POST /v1/agent` — Chat with page context (SSE response)
- `POST /v1/chat/history` — Get/manage chat history

### Agent SSE Events
```
event: chunk
data: {"text": "partial response..."}

event: assistant
data: {"role": "assistant", "content": [...]}
```

Keepalives sent as SSE comments: `: keepalive\n\n`

---

## Custom Modifications (from upstream)

All these are changes made in the fork, not in the original repo:

1. **Tab-switch behavior**: No auto-summarize, chat persists per URL, background request persistence
2. **Concurrent agent requests**: Per-request AbortController map instead of single controller
3. **send() bypass**: Agent messages bypass isPanelOpen() gate
4. **Session persistence**: Port disconnect doesn't delete session from map
5. **Error logging**: logExtensionEvent calls at agent error, send failure, tab switch, background response save
6. **API key management**: .env file at ~/.summarize/.env instead of hardcoded in daemon.json
7. **Google thinking mode**: google.ts handles thought blocks
8. **Chat timeout**: 360s instead of 60s
9. **SSE keepalive**: Proper comment format and skip in parser
10. **Daemon keepalive SSE format**: server.ts sends `: keepalive\n\n`
11. **Deep Analysis mode**: `AnalysisMode` type (`summarize` | `deep-analysis`), `buildDeepAnalysisPrompt()` in `packages/core/src/prompts/deep-analysis-system.ts`, wired through both summarization paths
12. **Gemini Grounding**: `completeGoogleWithGrounding()` in `google.ts` uses `google_search: {}` tool (v1beta API), model `gemini-2.5-flash` hardcoded in `agent.ts`. Raw HTTP call (not pi-ai) since grounding isn't natively supported by the library
