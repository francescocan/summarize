import { describe, expect, it } from 'vitest'

import { resolveExtractedTimestamp } from '../src/slides/index.js'

describe('resolveExtractedTimestamp', () => {
  it('falls back to requested when actual is missing', () => {
    expect(resolveExtractedTimestamp({ requested: 12.5, actual: null })).toBe(12.5)
  })

  it('treats small actual values as offsets', () => {
    expect(resolveExtractedTimestamp({ requested: 120.1, actual: 0.4 })).toBeCloseTo(120.5, 4)
  })

  it('uses actual when it looks absolute', () => {
    expect(resolveExtractedTimestamp({ requested: 10, actual: 42.25 })).toBe(42.25)
  })
})
