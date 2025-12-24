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
})
