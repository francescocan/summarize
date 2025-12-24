import { describe, expect, it, vi } from 'vitest'

import type { LinkPreviewProgressEvent } from '../src/content/link-preview/deps.js'
import { createWebsiteProgress } from '../src/tty/website-progress.js'

describe('tty/website-progress', () => {
  it('renders fetch progress with sane formatting and stops ticking after done', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const texts: string[] = []
    const progress = createWebsiteProgress({
      enabled: true,
      spinner: { setText: (text) => texts.push(text) },
    })
    expect(progress).not.toBeNull()

    progress!.onProgress({ kind: 'fetch-html-start', url: 'https://example.com' })

    vi.setSystemTime(162_000)
    progress!.onProgress({
      kind: 'fetch-html-progress',
      url: 'https://example.com',
      downloadedBytes: 136 * 1024,
      totalBytes: 15 * 1024,
    })

    const last = texts.at(-1) ?? ''
    expect(last).toContain('Fetching website (136 KB, 2m 42s')
    expect(last).toContain('B/s')
    expect(last).not.toContain('2m42s')
    expect(last).not.toContain('KB/')

    const beforeDoneCount = texts.length
    progress!.onProgress({
      kind: 'fetch-html-done',
      url: 'https://example.com',
      downloadedBytes: 136 * 1024,
      totalBytes: 15 * 1024,
    })
    expect(texts.length).toBeGreaterThan(beforeDoneCount)

    const afterDoneCount = texts.length
    vi.advanceTimersByTime(5000)
    expect(texts.length).toBe(afterDoneCount)

    vi.useRealTimers()
  })

  it('switches to a transcript phase so long transcriptions do not look like stuck fetches', () => {
    const texts: string[] = []
    const progress = createWebsiteProgress({
      enabled: true,
      spinner: { setText: (text) => texts.push(text) },
    })
    expect(progress).not.toBeNull()

    const event: LinkPreviewProgressEvent = {
      kind: 'transcript-start',
      url: 'https://example.com',
      service: 'podcast',
      hint: 'podcast',
    }
    progress!.onProgress(event)

    expect(texts.at(-1)).toBe('Transcribing (podcast)…')
  })

  it('renders audio download + whisper progress with sane formatting', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const texts: string[] = []
    const progress = createWebsiteProgress({
      enabled: true,
      spinner: { setText: (text) => texts.push(text) },
    })
    expect(progress).not.toBeNull()

    progress!.onProgress({
      kind: 'transcript-media-download-start',
      url: 'https://example.com',
      service: 'podcast',
      mediaUrl: 'https://cdn.example.com/audio.mp3',
      totalBytes: 15 * 1024,
    })

    vi.setSystemTime(162_000)
    progress!.onProgress({
      kind: 'transcript-media-download-progress',
      url: 'https://example.com',
      service: 'podcast',
      downloadedBytes: 136 * 1024,
      totalBytes: 15 * 1024,
    })

    const lastDownload = texts.at(-1) ?? ''
    expect(lastDownload).toContain('Downloading audio (136 KB, 2m 42s')
    expect(lastDownload).toContain('B/s')
    expect(lastDownload).not.toContain('2m42s')
    expect(lastDownload).not.toContain('KB/')

    progress!.onProgress({
      kind: 'transcript-media-download-done',
      url: 'https://example.com',
      service: 'podcast',
      downloadedBytes: 136 * 1024,
      totalBytes: 15 * 1024,
    })

    vi.setSystemTime(162_000)
    progress!.onProgress({
      kind: 'transcript-whisper-start',
      url: 'https://example.com',
      service: 'podcast',
      providerHint: 'openai',
      totalDurationSeconds: 3600,
      parts: null,
    })

    vi.setSystemTime(287_000)
    progress!.onProgress({
      kind: 'transcript-whisper-progress',
      url: 'https://example.com',
      service: 'podcast',
      processedDurationSeconds: 600,
      totalDurationSeconds: 3600,
      partIndex: 1,
      parts: 6,
    })

    const lastWhisper = texts.at(-1) ?? ''
    expect(lastWhisper).toContain('Transcribing (Whisper/OpenAI, 10m/1h')
    expect(lastWhisper).toContain('1/6')
    expect(lastWhisper).toContain('2m 5s')

    vi.useRealTimers()
  })
})
