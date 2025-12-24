import { describe, expect, it } from 'vitest'

import { formatBytes, formatElapsedMs } from '../src/tty/format.js'

describe('tty/format', () => {
  it('formats elapsed time with smart spacing', () => {
    expect(formatElapsedMs(5800)).toBe('5.8s')
    expect(formatElapsedMs(44_000)).toBe('44s')
    expect(formatElapsedMs(162_000)).toBe('2m 42s')
  })

  it('formats bytes without floats', () => {
    expect(formatBytes(988.2154524260012)).toBe('988 B')
    expect(formatBytes(136 * 1024)).toBe('136 KB')
  })
})

