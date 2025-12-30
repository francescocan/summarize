import { Readability } from '@mozilla/readability'
import { defineContentScript } from 'wxt/utils/define-content-script'
import { resolveMediaDurationSecondsFromData } from '../lib/media-duration'

type ExtractRequest = { type: 'extract'; maxChars: number }
type ExtractResponse =
  | {
      ok: true
      url: string
      title: string | null
      text: string
      truncated: boolean
      mediaDurationSeconds?: number | null
      media?: {
        hasVideo: boolean
        hasAudio: boolean
        hasCaptions: boolean
      }
    }
  | { ok: false; error: string }

function clampText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  const sliced = text.slice(0, Math.max(0, maxChars - 24))
  return { text: `${sliced}\n\n[TRUNCATED]`, truncated: true }
}

function resolveMediaDurationSeconds(): number | null {
  const metaDuration = document.querySelector('meta[itemprop="duration"]')?.getAttribute('content')
  const uiDuration = document.querySelector('.ytp-time-duration')?.textContent?.trim()
  const media = document.querySelector('video')
  const videoDuration =
    media && typeof (media as HTMLVideoElement).duration === 'number'
      ? (media as HTMLVideoElement).duration
      : null
  return resolveMediaDurationSecondsFromData({ metaDuration, uiDuration, videoDuration })
}

function detectMediaInfo(): { hasVideo: boolean; hasAudio: boolean; hasCaptions: boolean } {
  const hasVideo = Boolean(document.querySelector('video'))
  const hasAudio = Boolean(document.querySelector('audio'))
  const hasCaptions = Boolean(document.querySelector('track[kind="captions"], track[kind="subtitles"]'))
  return { hasVideo, hasAudio, hasCaptions }
}

function extract(maxChars: number): ExtractResponse {
  try {
    const url = location.href
    const title = document.title || null
    const mediaDurationSeconds = resolveMediaDurationSeconds()
    const media = detectMediaInfo()
    const cloned = document.cloneNode(true) as Document
    const reader = new Readability(cloned, { keepClasses: false })
    const parsed = reader.parse()
    const raw = parsed?.textContent?.trim() || document.body?.innerText?.trim() || ''
    if (!raw) {
      if (mediaDurationSeconds || media.hasVideo || media.hasAudio || media.hasCaptions) {
        return {
          ok: true,
          url,
          title,
          text: '',
          truncated: false,
          mediaDurationSeconds,
          media,
        }
      }
      return { ok: false, error: 'No readable text found.' }
    }
    const clamped = clampText(raw, maxChars)
    return {
      ok: true,
      url,
      title: parsed?.title?.trim() || title,
      text: clamped.text,
      truncated: clamped.truncated,
      mediaDurationSeconds,
      media,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Extraction failed' }
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    const flag = '__summarize_extract_installed__'
    if ((globalThis as unknown as Record<string, unknown>)[flag]) return
    ;(globalThis as unknown as Record<string, unknown>)[flag] = true

    chrome.runtime.onMessage.addListener(
      (message: ExtractRequest, _sender, sendResponse: (response: ExtractResponse) => void) => {
        if (message?.type !== 'extract') return
        sendResponse(extract(message.maxChars))
        return true
      }
    )
  },
})
