import { type SseMetaData, parseSseEvent } from '../../../../../src/shared/sse-events.js'
import { mergeStreamingChunk } from '../../../../../src/shared/streaming-merge.js'
import { parseSseStream } from '../../lib/sse'
import type { PanelPhase, RunStart } from './types'

export type StreamController = {
  start: (run: RunStart) => Promise<void>
  abort: () => void
  isStreaming: () => boolean
}

export function createStreamController({
  getToken,
  onReset,
  onStatus,
  onBaseTitle,
  onBaseSubtitle,
  onPhaseChange,
  onRememberUrl,
  onMeta,
  onSummaryFromCache,
  onMetrics,
  onRender,
  onSyncWithActiveTab,
  onError,
  fetchImpl,
}: {
  getToken: () => Promise<string>
  onReset: () => void
  onStatus: (text: string) => void
  onBaseTitle: (text: string) => void
  onBaseSubtitle: (text: string) => void
  onPhaseChange: (phase: PanelPhase) => void
  onRememberUrl: (url: string) => void
  onMeta: (meta: SseMetaData) => void
  onSummaryFromCache: (value: boolean | null) => void
  onMetrics: (summary: string) => void
  onRender: (markdown: string) => void
  onSyncWithActiveTab: () => Promise<void>
  onError?: ((error: unknown) => string) | null
  fetchImpl?: typeof fetch
}): StreamController {
  let controller: AbortController | null = null
  let markdown = ''
  let renderQueued = 0
  let streamedAnyNonWhitespace = false
  let rememberedUrl = false
  let streaming = false

  const queueRender = () => {
    if (renderQueued) return
    renderQueued = window.setTimeout(() => {
      renderQueued = 0
      onRender(markdown)
    }, 80)
  }

  const abort = () => {
    if (!controller) return
    controller.abort()
    controller = null
    if (streaming) {
      streaming = false
      onPhaseChange('idle')
    }
  }

  const start = async (run: RunStart) => {
    const token = (await getToken()).trim()
    if (!token) {
      onStatus('Setup required (missing token)')
      return
    }

    abort()
    const nextController = new AbortController()
    controller = nextController
    streaming = true
    streamedAnyNonWhitespace = false
    rememberedUrl = false
    markdown = ''
    onPhaseChange('connecting')
    onSummaryFromCache(null)
    onReset()

    onBaseTitle(run.title || run.url)
    onBaseSubtitle('')
    onStatus('Connecting…')

    try {
      const res = await (fetchImpl ?? fetch)(
        `http://127.0.0.1:8787/v1/summarize/${run.id}/events`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: nextController.signal,
        }
      )
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      if (!res.body) throw new Error('Missing stream body')

      onStatus('Summarizing…')
      onPhaseChange('streaming')

      for await (const msg of parseSseStream(res.body)) {
        if (nextController.signal.aborted) return

        const event = parseSseEvent(msg)
        if (!event) continue

        if (event.event === 'chunk') {
          const merged = mergeStreamingChunk(markdown, event.data.text).next
          if (merged !== markdown) {
            markdown = merged
            queueRender()
          }

          if (!streamedAnyNonWhitespace && event.data.text.trim().length > 0) {
            streamedAnyNonWhitespace = true
            if (!rememberedUrl) {
              rememberedUrl = true
              onRememberUrl(run.url)
            }
          }
        } else if (event.event === 'meta') {
          onMeta(event.data)
          if (typeof event.data.summaryFromCache === 'boolean') {
            onSummaryFromCache(event.data.summaryFromCache)
          }
        } else if (event.event === 'status') {
          if (!streamedAnyNonWhitespace) onStatus(event.data.text)
        } else if (event.event === 'metrics') {
          onMetrics(event.data.summary)
        } else if (event.event === 'error') {
          throw new Error(event.data.message)
        } else if (event.event === 'done') {
          break
        }
      }

      if (!streamedAnyNonWhitespace) {
        throw new Error('Model returned no output.')
      }

      onStatus('')
    } catch (err) {
      if (nextController.signal.aborted) return
      const message = onError ? onError(err) : err instanceof Error ? err.message : String(err)
      onStatus(`Error: ${message}`)
      onPhaseChange('error')
    } finally {
      if (controller === nextController) {
        streaming = false
        if (!nextController.signal.aborted) {
          onPhaseChange('idle')
        }
        await onSyncWithActiveTab()
      }
    }
  }

  return {
    start,
    abort,
    isStreaming: () => streaming,
  }
}
