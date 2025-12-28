import { describe, expect, it } from 'vitest'

import {
  resolveDaemonFirecrawlMode,
  resolveDaemonMarkdownMode,
  resolveDaemonMaxOutputTokens,
  resolveDaemonPreprocessMode,
  resolveDaemonRetries,
  resolveDaemonTimeoutMs,
  resolveDaemonYoutubeMode,
} from '../src/daemon/request-settings.js'

describe('daemon/request-settings', () => {
  it('parses mode overrides when valid', () => {
    expect(resolveDaemonFirecrawlMode('always')).toBe('always')
    expect(resolveDaemonMarkdownMode('llm')).toBe('llm')
    expect(resolveDaemonPreprocessMode('auto')).toBe('auto')
    expect(resolveDaemonYoutubeMode('no-auto')).toBe('no-auto')
  })

  it('returns null for invalid modes', () => {
    expect(resolveDaemonFirecrawlMode('nope')).toBeNull()
    expect(resolveDaemonMarkdownMode('markdown')).toBeNull()
    expect(resolveDaemonPreprocessMode('yes')).toBeNull()
    expect(resolveDaemonYoutubeMode('v2')).toBeNull()
  })

  it('parses timeout, retries, and max output tokens', () => {
    expect(resolveDaemonTimeoutMs('90s')).toBe(90_000)
    expect(resolveDaemonTimeoutMs(15_000)).toBe(15_000)
    expect(resolveDaemonRetries('3')).toBe(3)
    expect(resolveDaemonRetries(2)).toBe(2)
    expect(resolveDaemonMaxOutputTokens('2k')).toBe(2000)
    expect(resolveDaemonMaxOutputTokens(512)).toBe(512)
  })
})
