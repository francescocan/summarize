# Lessons Learned — Summarize Extension

Reference this skill when debugging issues or making changes to avoid repeating past mistakes.

---

## Lesson 1: `send()` Silently Drops Messages (background.ts)

**Problem**: The `send()` function in background.ts gates ALL messages behind `isPanelOpen()`. If the panel's ping timer expires (45s timeout, 25s ping interval = only 20s margin) or if `panelOpen` is false for any reason, messages are silently dropped with no error.

**Fix applied**: Agent messages (`agent:chunk`, `agent:response`) now bypass the `isPanelOpen()` check. Error logging was added to the catch block.

**Rule**: Never gate critical response messages behind isPanelOpen(). The sidepanel handles its own routing.

---

## Lesson 2: `panel:ready` and `panel:closed` Fire More Than You Think

**Problem**: `panel:ready` fires on every `visibilitychange` (visible) and `focus` event — not just initial panel open. `panel:closed` fires on visibility hidden. If these handlers abort agent controllers, every time the user alt-tabs or the window loses focus, all running chat requests die.

**Fix applied**: Removed agent controller aborts from both `panel:ready` and `panel:closed`. Only `panel:agent-abort` (explicit user action) and `registerPanelSession` (port replacement) abort agent controllers.

**Rule**: Only abort agent controllers on explicit user action or full session reset.

---

## Lesson 3: Single AgentController = Only One Chat at a Time

**Problem**: The original code had a single `session.agentController`. Every new `panel:agent` request called `session.agentController?.abort()` first, killing the previous request. With URL-based chat (different tabs = different chats), this meant only the most recent tab's question got answered.

**Fix applied**: Changed to `session.agentControllers: Map<string, AbortController>` keyed by requestId. Each request gets its own controller. The finally block cleans up only its own entry.

**Rule**: Always use per-request controllers when concurrent requests are possible.

---

## Lesson 4: Port Disconnect Deletes Session, Breaks In-Flight Closures

**Problem**: The port `onDisconnect` handler called `panelSessions.delete(windowId)`. If a port disconnects and reconnects (Chrome service worker restart, etc.), in-flight async agent handlers still hold a reference to the OLD session object (captured in closure). The old session has `panelOpen = false` and a dead port. Even with `isPanelOpen` bypass, `port.postMessage()` throws on a disconnected port.

**Fix applied**: Removed `panelSessions.delete(windowId)` from onDisconnect. The session stays in the map. When the port reconnects, `registerPanelSession()` updates `session.port` on the SAME object, so in-flight closures see the new port.

**Rule**: Never delete session objects that might be captured in async closures. Mark them as inactive instead.

---

## Lesson 5: Chat History Must Be Keyed by URL, Not Tab ID

**Problem**: Originally, chat history was keyed by tab ID. When users open the same page in different tabs, or want chat to persist across tab closes/reopens, tab ID fails.

**Fix applied**: Changed `chatHistoryCache` from `Map<number, ChatMessage[]>` to `Map<string, ChatMessage[]>` (keyed by URL). `getChatHistoryKey()` accepts URL strings. Panel cache also changed to URL-keyed.

**Files changed**: `main.ts` (chatHistoryCache, getChatHistoryKey, persistChatHistory, loadChatHistory), `panel-cache.ts` (buildKey).

---

## Lesson 6: Save Chat Under OLD URL Before Switching

**Problem**: `persistChatHistory()` was async (fire-and-forget with `void`). By the time it ran, `activeTabUrl` had already been updated to the new tab's URL. Messages got saved under the wrong URL.

**Fix applied**: Capture `previousUrl = activeTabUrl` BEFORE updating it. Save synchronously to the cache map under the old URL. Then call `resetChatState()` and `restoreChatHistory()` for the new URL.

**Rule**: Always capture the old state before updating global variables in tab-switch handlers.

---

## Lesson 7: `requestAgentAbort()` Shows Error UI

**Problem**: Calling `requestAgentAbort('Tab changed')` on tab switch propagated the error message through `abortPendingAgentRequests()` -> rejected promise -> catch block -> `errorController.showInlineError('Tab changed')`. Users saw a red "Tab changed" error box.

**Fix applied**: Removed `requestAgentAbort()` from tab switch. Instead, just detach `pendingAgentRequests` entries (delete from map) and call `resetChatState()`.

**Rule**: Use silent detachment, not abort-with-error, for expected lifecycle events.

---

## Lesson 8: Auto-Summarize Was Triggering on Every Tab Switch

**Problem**: Original code called `summarizeActiveTab()` inside `chrome.tabs.onActivated`, `chrome.tabs.onUpdated`, and `chrome.webNavigation.onHistoryStateUpdated` listeners. Every tab switch triggered a new summarization.

**Fix applied**: Removed all `summarizeActiveTab()` calls from these listeners. User must explicitly click Summarize.

---

## Lesson 9: API Keys Must Not Be in Source Code

**Problem**: Initial setup had API keys hardcoded in `daemon.json` which gets committed to the fork.

**Fix applied**: Created `~/.summarize/.env` file with API keys. Modified `src/daemon/env-merge.ts` to load from `.env`. The `.env` is outside the repo.

---

## Lesson 10: Daemon SSE Keepalive Format

**Problem**: The daemon sends keepalive comments as `: keepalive\n\n` in the SSE stream. The stream parser in the extension was processing these as events, causing errors.

**Fix applied**: `stream-controller.ts` skips lines starting with `:` (SSE comment format). `server.ts` sends keepalives in proper SSE comment format.

---

## Lesson 11: Google Gemini Thinking Mode

**Problem**: Google's Gemini model with thinking mode enabled returns `thought` blocks that the generate-text handler didn't expect.

**Fix applied**: `src/llm/google.ts` handles thinking mode responses, extracting the actual content from thought blocks.

---

## Lesson 12: Chat Timeout Too Short

**Problem**: Default chat timeout was 60 seconds. Complex questions with long page content easily exceeded this.

**Fix applied**: Increased to 360 seconds in `main.ts`.

---

## Lesson 13: Google Grounding API Format Changed (`google_search_retrieval` → `google_search`)

**Problem**: The `completeGoogleWithGrounding()` function was using the deprecated `google_search_retrieval` tool with `dynamic_retrieval_config: { mode: 'MODE_DYNAMIC', dynamic_threshold: 0.3 }`. Google deprecated this format for Gemini 2.0+ models. The API returned a 400 error: "Please use google_search field instead of google_search_retrieval field." The original error handler didn't include the actual Google error message, making this hard to diagnose.

**Fix applied**:
1. Changed tool payload from `{ google_search_retrieval: { dynamic_retrieval_config: {...} } }` to `{ google_search: {} }` in `google.ts`
2. Upgraded grounding model from `gemini-2.0-flash` (deprecated, shutting down March 2026) to `gemini-2.5-flash` in `agent.ts`
3. Improved error reporting to parse and include Google's actual error message from the JSON response body

**Rule**: Always include the actual API error details when throwing errors from HTTP responses — generic "error (status)" messages hide the root cause. Also: Google regularly deprecates API tool formats; when a grounding call fails, check the [official docs](https://ai.google.dev/gemini-api/docs/google-search) for the current format.

---

## Lesson 14: Daemon Restart May Not Kill Old Process

**Problem**: Running `daemon restart` via Scheduled Task didn't always kill the old Node process. The old PID kept running the pre-fix code while the new process failed to bind the port (or never started). Health check returned the old PID, confirming stale code was serving requests.

**Fix applied**: Force-killed the old process with `taskkill //F //PID <old_pid>`, then restarted.

**Rule**: After significant daemon code changes, verify the PID changed after restart (`GET /health` returns `pid`). If same PID, force-kill it. On Windows Git Bash, use `//F` (double slash) for taskkill flags.

---

## Debugging Tips

1. **Extension logs**: Options page > Logs tab. Look for `agent:error`, `bg:send-failed`, `chat:background-response-saved` events.
2. **Daemon logs**: Check daemon terminal output for HTTP request/response logs.
3. **Chrome DevTools**: Right-click extension icon > "Inspect popup" or use `chrome://extensions` > service worker link to debug background.ts.
4. **Network tab**: In background service worker DevTools, filter by `127.0.0.1:8787` to see daemon requests.
5. **Test daemon directly**: `curl http://127.0.0.1:8787/health` and `curl -H "Authorization: Bearer TOKEN" http://127.0.0.1:8787/ping`.
