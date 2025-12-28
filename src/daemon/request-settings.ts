import type {
  FirecrawlMode,
  LengthArg,
  MarkdownMode,
  PreprocessMode,
  YoutubeMode,
} from '../flags.js'
import {
  parseDurationMs,
  parseFirecrawlMode,
  parseLengthArg,
  parseMarkdownMode,
  parseMaxOutputTokensArg,
  parsePreprocessMode,
  parseRetriesArg,
  parseYoutubeMode,
} from '../flags.js'
import type { OutputLanguage } from '../language.js'
import { resolveOutputLanguage } from '../language.js'
import type { SummaryLengthTarget } from '../prompts/index.js'

export type DaemonRunOverrides = {
  firecrawlMode: FirecrawlMode | null
  markdownMode: MarkdownMode | null
  preprocessMode: PreprocessMode | null
  youtubeMode: YoutubeMode | null
  timeoutMs: number | null
  retries: number | null
  maxOutputTokensArg: number | null
}

export function resolveDaemonSummaryLength(raw: unknown): {
  lengthArg: LengthArg
  summaryLength: SummaryLengthTarget
} {
  const value = typeof raw === 'string' ? raw.trim() : ''
  const lengthArg = parseLengthArg(value || 'xl')
  const summaryLength =
    lengthArg.kind === 'preset' ? lengthArg.preset : { maxCharacters: lengthArg.maxCharacters }
  return { lengthArg, summaryLength }
}

export function resolveDaemonOutputLanguage({
  raw,
  fallback,
}: {
  raw: unknown
  fallback: OutputLanguage
}): OutputLanguage {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return fallback
  return resolveOutputLanguage(value)
}

export function resolveDaemonYoutubeMode(raw: unknown): YoutubeMode | null {
  if (typeof raw !== 'string') return null
  try {
    return parseYoutubeMode(raw)
  } catch {
    return null
  }
}

export function resolveDaemonFirecrawlMode(raw: unknown): FirecrawlMode | null {
  if (typeof raw !== 'string') return null
  try {
    return parseFirecrawlMode(raw)
  } catch {
    return null
  }
}

export function resolveDaemonMarkdownMode(raw: unknown): MarkdownMode | null {
  if (typeof raw !== 'string') return null
  try {
    return parseMarkdownMode(raw)
  } catch {
    return null
  }
}

export function resolveDaemonPreprocessMode(raw: unknown): PreprocessMode | null {
  if (typeof raw !== 'string') return null
  try {
    return parsePreprocessMode(raw)
  } catch {
    return null
  }
}

export function resolveDaemonTimeoutMs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw)
  if (typeof raw !== 'string') return null
  try {
    return parseDurationMs(raw)
  } catch {
    return null
  }
}

export function resolveDaemonRetries(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw)) return raw
  if (typeof raw !== 'string') return null
  try {
    return parseRetriesArg(raw)
  } catch {
    return null
  }
}

export function resolveDaemonMaxOutputTokens(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw)
  if (typeof raw !== 'string') return null
  try {
    return parseMaxOutputTokensArg(raw)
  } catch {
    return null
  }
}
