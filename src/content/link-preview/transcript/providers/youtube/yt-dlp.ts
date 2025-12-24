import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  transcribeMediaFileWithWhisper,
  type TranscriptionProvider,
} from '../../../../../transcription/whisper.js'

const YT_DLP_TIMEOUT_MS = 300_000
const MAX_STDERR_BYTES = 8192

type YtDlpTranscriptResult = {
  text: string | null
  provider: TranscriptionProvider | null
  error: Error | null
  notes: string[]
}

type YtDlpRequest = {
  ytDlpPath: string | null
  openaiApiKey: string | null
  falApiKey: string | null
  url: string
}

export const fetchTranscriptWithYtDlp = async ({
  ytDlpPath,
  openaiApiKey,
  falApiKey,
  url,
}: YtDlpRequest): Promise<YtDlpTranscriptResult> => {
  const notes: string[] = []

  if (!ytDlpPath) {
    return { text: null, provider: null, error: new Error('YT_DLP_PATH is not configured'), notes }
  }
  if (!openaiApiKey && !falApiKey) {
    return {
      text: null,
      provider: null,
      error: new Error('OPENAI_API_KEY or FAL_KEY is required for yt-dlp transcription'),
      notes,
    }
  }

  const outputFile = join(tmpdir(), `summarize-${randomUUID()}.mp3`)
  try {
    await downloadAudio(ytDlpPath, url, outputFile)
    const result = await transcribeMediaFileWithWhisper({
      filePath: outputFile,
      mediaType: 'audio/mpeg',
      filename: 'audio.mp3',
      openaiApiKey,
      falApiKey,
    })
    if (result.notes.length > 0) notes.push(...result.notes)
    return { text: result.text, provider: result.provider, error: result.error, notes }
  } catch (error) {
    return {
      text: null,
      provider: null,
      error: wrapError('yt-dlp failed to download audio', error),
      notes,
    }
  } finally {
    await fs.unlink(outputFile).catch(() => {})
  }
}

async function downloadAudio(ytDlpPath: string, url: string, outputFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-x',
      '--audio-format',
      'mp3',
      '--no-playlist',
      '--retries',
      '3',
      '--no-warnings',
      '-o',
      outputFile,
      url,
    ]

    const proc = spawn(ytDlpPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''

    if (proc.stderr) {
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        if (stderr.length >= MAX_STDERR_BYTES) return
        const remaining = MAX_STDERR_BYTES - stderr.length
        stderr += chunk.slice(0, remaining)
      })
    }

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error('yt-dlp download timeout'))
    }, YT_DLP_TIMEOUT_MS)

    proc.on('close', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
        return
      }
      const detail = stderr.trim()
      const suffix = detail ? `: ${detail}` : ''
      if (code === null) {
        reject(new Error(`yt-dlp terminated (${signal ?? 'unknown'})${suffix}`))
        return
      }
      reject(new Error(`yt-dlp exited with code ${code}${suffix}`))
    })

    proc.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

function wrapError(prefix: string, error: unknown): Error {
  if (error instanceof Error) {
    return new Error(`${prefix}: ${error.message}`, { cause: error })
  }
  return new Error(`${prefix}: ${String(error)}`)
}
