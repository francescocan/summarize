import { execFile } from 'node:child_process'
import { BIRD_TIP, TWITTER_HOSTS } from './constants.js'
import { hasBirdCli } from './env.js'

type BirdTweetPayload = {
  id?: string
  text: string
  author?: { username?: string; name?: string }
  createdAt?: string
}

function isTwitterStatusUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (!TWITTER_HOSTS.has(host)) return false
    return /\/status\/\d+/.test(parsed.pathname)
  } catch {
    return false
  }
}

export async function readTweetWithBird(args: {
  url: string
  timeoutMs: number
  env: Record<string, string | undefined>
}): Promise<BirdTweetPayload> {
  return await new Promise((resolve, reject) => {
    execFile(
      'bird',
      ['read', args.url, '--json'],
      {
        timeout: args.timeoutMs,
        env: { ...process.env, ...args.env },
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim()
          const suffix = detail ? `: ${detail}` : ''
          reject(new Error(`bird read failed${suffix}`))
          return
        }
        const trimmed = stdout.trim()
        if (!trimmed) {
          reject(new Error('bird read returned empty output'))
          return
        }
        try {
          const parsed = JSON.parse(trimmed) as BirdTweetPayload | BirdTweetPayload[]
          const tweet = Array.isArray(parsed) ? parsed[0] : parsed
          if (!tweet || typeof tweet.text !== 'string') {
            reject(new Error('bird read returned invalid payload'))
            return
          }
          resolve(tweet)
        } catch (parseError) {
          const message = parseError instanceof Error ? parseError.message : String(parseError)
          reject(new Error(`bird read returned invalid JSON: ${message}`))
        }
      }
    )
  })
}

export function withBirdTip(
  error: unknown,
  url: string | null,
  env: Record<string, string | undefined>
): Error {
  if (!url || !isTwitterStatusUrl(url) || hasBirdCli(env)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  const message = error instanceof Error ? error.message : String(error)
  const combined = `${message}\n${BIRD_TIP}`
  return error instanceof Error ? new Error(combined, { cause: error }) : new Error(combined)
}
