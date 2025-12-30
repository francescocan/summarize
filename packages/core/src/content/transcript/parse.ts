export function vttToPlainText(raw: string): string {
  const lines = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line.toUpperCase() !== 'WEBVTT')
    .filter((line) => !/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/.test(line))
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/^(NOTE|STYLE|REGION)\b/i.test(line))
  return lines.join('\n').trim()
}

export function jsonTranscriptToPlainText(payload: unknown): string | null {
  if (Array.isArray(payload)) {
    const parts = payload
      .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>).text : null))
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim())
      .filter(Boolean)
    const text = parts.join('\n').trim()
    return text.length > 0 ? text : null
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (typeof record.transcript === 'string' && record.transcript.trim())
      return record.transcript.trim()
    if (typeof record.text === 'string' && record.text.trim()) return record.text.trim()
    const segments = record.segments
    if (Array.isArray(segments)) {
      const parts = segments
        .map((row) =>
          row && typeof row === 'object' ? (row as Record<string, unknown>).text : null
        )
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
      const text = parts.join('\n').trim()
      return text.length > 0 ? text : null
    }
  }

  return null
}
