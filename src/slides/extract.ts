import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ExtractedLinkContent } from '../content/index.js'
import { extractYouTubeVideoId, isDirectMediaUrl, isYouTubeUrl } from '../content/index.js'
import { generateTextWithModelId } from '../llm/generate-text.js'
import type { Prompt } from '../llm/prompt.js'
import { resolveExecutableInPath } from '../run/env.js'
import type { SlideSettings } from './settings.js'
import type {
  SlideAutoTune,
  SlideExtractionResult,
  SlideImage,
  SlideLlmConfig,
  SlideRoi,
  SlideSource,
} from './types.js'

const FFMPEG_TIMEOUT_FALLBACK_MS = 300_000
const YT_DLP_TIMEOUT_MS = 300_000
const TESSERACT_TIMEOUT_MS = 120_000
const DEFAULT_SLIDES_WORKERS = 8
const DEFAULT_YT_DLP_FORMAT = 'best[height<=360]/best'

function logSlides(message: string): void {
  console.log(`[summarize-slides] ${message}`)
}

function logSlidesTiming(label: string, startedAt: number): number {
  const elapsedMs = Date.now() - startedAt
  logSlides(`${label} elapsedMs=${elapsedMs}`)
  return elapsedMs
}

function resolveSlidesWorkers(env: Record<string, string | undefined>): number {
  const raw = env.SUMMARIZE_SLIDES_WORKERS ?? env.SLIDES_WORKERS
  if (!raw) return DEFAULT_SLIDES_WORKERS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SLIDES_WORKERS
  return Math.max(1, Math.min(16, Math.round(parsed)))
}

function resolveSlidesYtDlpFormat(env: Record<string, string | undefined>): string {
  return (
    env.SUMMARIZE_SLIDES_YTDLP_FORMAT ??
    env.SLIDES_YTDLP_FORMAT ??
    DEFAULT_YT_DLP_FORMAT
  ).trim()
}

type ExtractSlidesArgs = {
  source: SlideSource
  settings: SlideSettings
  llm?: SlideLlmConfig | null
  env: Record<string, string | undefined>
  timeoutMs: number
  ytDlpPath: string | null
  ffmpegPath: string | null
  tesseractPath: string | null
}

export function resolveSlideSource({
  url,
  extracted,
}: {
  url: string
  extracted: ExtractedLinkContent
}): SlideSource | null {
  const directUrl = extracted.video?.url ?? extracted.url
  const youtubeCandidate =
    extractYouTubeVideoId(extracted.video?.url ?? '') ??
    extractYouTubeVideoId(extracted.url) ??
    extractYouTubeVideoId(url)
  if (youtubeCandidate) {
    return {
      url: `https://www.youtube.com/watch?v=${youtubeCandidate}`,
      kind: 'youtube',
      sourceId: youtubeCandidate,
    }
  }

  if (extracted.video?.kind === 'direct' || isDirectMediaUrl(directUrl) || isDirectMediaUrl(url)) {
    const normalized = directUrl || url
    return {
      url: normalized,
      kind: 'direct',
      sourceId: buildDirectSourceId(normalized),
    }
  }

  if (isYouTubeUrl(url)) {
    const fallbackId = extractYouTubeVideoId(url)
    if (fallbackId) {
      return {
        url: `https://www.youtube.com/watch?v=${fallbackId}`,
        kind: 'youtube',
        sourceId: fallbackId,
      }
    }
  }

  return null
}

export async function extractSlidesForSource({
  source,
  settings,
  llm,
  env,
  timeoutMs,
  ytDlpPath,
  ffmpegPath,
  tesseractPath,
}: ExtractSlidesArgs): Promise<SlideExtractionResult> {
  const warnings: string[] = []
  const workers = resolveSlidesWorkers(env)
  const totalStartedAt = Date.now()
  logSlides(
    `pipeline=download(sequential)->scene-detect(parallel:${workers})->extract-frames(parallel:${workers})->ocr(parallel:${workers})`
  )

  const ffmpegBinary = ffmpegPath ?? resolveExecutableInPath('ffmpeg', env)
  if (!ffmpegBinary) {
    throw new Error('Missing ffmpeg (install ffmpeg or add it to PATH).')
  }
  const ffprobeBinary = resolveExecutableInPath('ffprobe', env)

  if (settings.ocr && !tesseractPath) {
    const resolved = resolveExecutableInPath('tesseract', env)
    if (!resolved) {
      throw new Error('Missing tesseract OCR (install tesseract or skip --slides-ocr).')
    }
    tesseractPath = resolved
  }

  const slidesDir = path.join(settings.outputDir, source.sourceId)
  {
    const prepareStartedAt = Date.now()
    await prepareSlidesDir(slidesDir)
    logSlidesTiming('prepare output dir', prepareStartedAt)
  }

  let inputPath = source.url
  let cleanupTemp: (() => Promise<void>) | null = null

  if (source.kind === 'youtube') {
    if (!ytDlpPath) {
      throw new Error('Slides for YouTube require yt-dlp (set YT_DLP_PATH or install yt-dlp).')
    }
    const downloadStartedAt = Date.now()
    const format = resolveSlidesYtDlpFormat(env)
    const downloaded = await downloadYoutubeVideo({ ytDlpPath, url: source.url, timeoutMs, format })
    inputPath = downloaded.filePath
    cleanupTemp = downloaded.cleanup
    logSlidesTiming(`yt-dlp download (sequential, format=${format})`, downloadStartedAt)
  }

  try {
    const ffmpegStartedAt = Date.now()
    const { slides: rawSlides, autoTune } = await extractSlidesWithFfmpeg({
      ffmpegPath: ffmpegBinary,
      ffprobePath: ffprobeBinary,
      inputPath,
      outputDir: slidesDir,
      sceneThreshold: settings.sceneThreshold,
      autoTuneThreshold: settings.autoTuneThreshold,
      maxSlides: settings.maxSlides,
      minDurationSeconds: settings.minDurationSeconds,
      llm,
      env,
      timeoutMs,
      warnings,
      workers,
    })
    logSlidesTiming('ffmpeg scene-detect + extract-frames', ffmpegStartedAt)

    const renameStartedAt = Date.now()
    const renamedSlides = await renameSlidesWithTimestamps(rawSlides, slidesDir)
    logSlidesTiming('rename slides', renameStartedAt)
    if (renamedSlides.length === 0) {
      throw new Error('No slides extracted; try lowering --slides-scene-threshold.')
    }

    let slidesWithOcr = renamedSlides
    const ocrAvailable = Boolean(tesseractPath)
    if (settings.ocr && tesseractPath) {
      const ocrStartedAt = Date.now()
      logSlides(`ocr start count=${renamedSlides.length} mode=parallel workers=${workers}`)
      slidesWithOcr = await runOcrOnSlides(renamedSlides, tesseractPath, workers)
      const elapsedMs = logSlidesTiming('ocr done', ocrStartedAt)
      if (renamedSlides.length > 0) {
        logSlides(`ocr avgMsPerSlide=${Math.round(elapsedMs / renamedSlides.length)}`)
      }
    }

    const result: SlideExtractionResult = {
      sourceUrl: source.url,
      sourceKind: source.kind,
      sourceId: source.sourceId,
      slidesDir,
      sceneThreshold: settings.sceneThreshold,
      autoTuneThreshold: settings.autoTuneThreshold,
      autoTune,
      maxSlides: settings.maxSlides,
      minSlideDuration: settings.minDurationSeconds,
      ocrRequested: settings.ocr,
      ocrAvailable,
      slides: slidesWithOcr,
      warnings,
    }

    await writeSlidesJson(result, slidesDir)
    logSlidesTiming('slides total', totalStartedAt)
    return result
  } finally {
    if (cleanupTemp) {
      await cleanupTemp()
    }
  }
}

export function parseShowinfoTimestamp(line: string): number | null {
  if (!line.includes('showinfo')) return null
  const match = /pts_time:(\d+\.?\d*)/.exec(line)
  if (!match) return null
  const ts = Number(match[1])
  if (!Number.isFinite(ts)) return null
  return ts
}

async function prepareSlidesDir(slidesDir: string): Promise<void> {
  await fs.mkdir(slidesDir, { recursive: true })
  const entries = await fs.readdir(slidesDir)
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.startsWith('slide_') && entry.endsWith('.png')) {
        await fs.rm(path.join(slidesDir, entry), { force: true })
      }
      if (entry === 'slides.json') {
        await fs.rm(path.join(slidesDir, entry), { force: true })
      }
    })
  )
}

async function downloadYoutubeVideo({
  ytDlpPath,
  url,
  timeoutMs,
  format,
}: {
  ytDlpPath: string
  url: string
  timeoutMs: number
  format: string
}): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), `summarize-slides-${randomUUID()}-`))
  const outputTemplate = path.join(dir, 'video.%(ext)s')
  const args = [
    '-f',
    format,
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '-o',
    outputTemplate,
    url,
  ]
  await runProcess({
    command: ytDlpPath,
    args,
    timeoutMs: Math.max(timeoutMs, YT_DLP_TIMEOUT_MS),
    errorLabel: 'yt-dlp',
  })

  const files = await fs.readdir(dir)
  const candidates = []
  for (const entry of files) {
    if (entry.endsWith('.part') || entry.endsWith('.ytdl')) continue
    const filePath = path.join(dir, entry)
    const stat = await fs.stat(filePath).catch(() => null)
    if (stat?.isFile()) {
      candidates.push({ filePath, size: stat.size })
    }
  }
  if (candidates.length === 0) {
    await fs.rm(dir, { recursive: true, force: true })
    throw new Error('yt-dlp completed but no video file was downloaded.')
  }
  candidates.sort((a, b) => b.size - a.size)
  const filePath = candidates[0].filePath
  return {
    filePath,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

async function extractSlidesWithFfmpeg({
  ffmpegPath,
  ffprobePath,
  inputPath,
  outputDir,
  sceneThreshold,
  autoTuneThreshold,
  maxSlides,
  minDurationSeconds,
  llm,
  env,
  timeoutMs,
  warnings,
  workers,
}: {
  ffmpegPath: string
  ffprobePath: string | null
  inputPath: string
  outputDir: string
  sceneThreshold: number
  autoTuneThreshold: boolean
  maxSlides: number
  minDurationSeconds: number
  llm?: SlideLlmConfig | null
  env: Record<string, string | undefined>
  timeoutMs: number
  warnings: string[]
  workers: number
}): Promise<{ slides: SlideImage[]; autoTune: SlideAutoTune }> {
  const targetMinSlides = Math.min(maxSlides, 5)
  const baseThreshold = sceneThreshold
  const minThreshold = 0.05

  const probeStartedAt = Date.now()
  const videoInfo = await probeVideoInfo({
    ffprobePath,
    env,
    inputPath,
    timeoutMs,
  })
  logSlidesTiming('ffprobe video info', probeStartedAt)

  const baseEvaluation = await detectSceneTimestampsAdaptive({
    ffmpegPath,
    inputPath,
    threshold: baseThreshold,
    minThreshold,
    targetMinSlides,
    timeoutMs,
    crop: null,
    warnings,
    durationSeconds: videoInfo.durationSeconds,
    workers,
  })

  let chosenThreshold = baseEvaluation.threshold
  let sceneTimestamps = baseEvaluation.timestamps
  let autoTune: SlideAutoTune =
    autoTuneThreshold && chosenThreshold !== baseThreshold
      ? {
          enabled: true,
          chosenThreshold,
          confidence: baseEvaluation.confidence,
          strategy: 'adaptive',
          roi: null,
        }
      : {
          enabled: false,
          chosenThreshold,
          confidence: baseEvaluation.confidence,
          strategy: 'none',
          roi: null,
        }

  if (autoTuneThreshold && sceneTimestamps.length === 0) {
    const roiStartedAt = Date.now()
    const roi = await detectSlideRoiWithLlm({
      ffmpegPath,
      inputPath,
      videoInfo,
      llm,
      warnings,
      timeoutMs,
    })
    logSlidesTiming('roi detect (llm)', roiStartedAt)
    if (roi && videoInfo.width && videoInfo.height) {
      const crop = resolveCropFromRoi(roi, videoInfo)
      if (crop) {
        const roiEvaluation = await detectSceneTimestampsAdaptive({
          ffmpegPath,
          inputPath,
          threshold: baseThreshold,
          minThreshold,
          targetMinSlides,
          timeoutMs,
          crop,
          warnings,
          durationSeconds: videoInfo.durationSeconds,
          workers,
        })
        if (roiEvaluation.confidence >= baseEvaluation.confidence + 0.05) {
          chosenThreshold = roiEvaluation.threshold
          sceneTimestamps = roiEvaluation.timestamps
          autoTune = {
            enabled: autoTuneThreshold,
            chosenThreshold,
            confidence: roiEvaluation.confidence,
            strategy: 'llm-roi',
            roi,
          }
        } else {
          autoTune.roi = roi
        }
      }
    }
  }

  if (autoTuneThreshold && chosenThreshold !== baseThreshold) {
    warnings.push(
      `Auto-tuned scene threshold from ${baseThreshold} to ${chosenThreshold} (detected ${sceneTimestamps.length} scenes)`
    )
  }

  const combined = mergeTimestamps(sceneTimestamps, [], minDurationSeconds)
  const trimmed = applyMaxSlidesFilter(
    combined.map((timestamp, index) => ({ index: index + 1, timestamp, imagePath: '' })),
    maxSlides,
    warnings
  )
  const extractFramesStartedAt = Date.now()
  const extracted = await extractFramesAtTimestamps({
    ffmpegPath,
    inputPath,
    outputDir,
    timestamps: trimmed.map((slide) => slide.timestamp),
    timeoutMs,
    workers,
  })
  const extractElapsedMs = logSlidesTiming(
    `extract frames (count=${trimmed.length}, parallel=${workers})`,
    extractFramesStartedAt
  )
  if (trimmed.length > 0) {
    logSlides(`extract frames avgMsPerFrame=${Math.round(extractElapsedMs / trimmed.length)}`)
  }
  const filtered = applyMinDurationFilter(extracted, minDurationSeconds, warnings)
  return { slides: filtered, autoTune }
}

async function extractFramesAtTimestamps({
  ffmpegPath,
  inputPath,
  outputDir,
  timestamps,
  timeoutMs,
  workers,
}: {
  ffmpegPath: string
  inputPath: string
  outputDir: string
  timestamps: number[]
  timeoutMs: number
  workers: number
}): Promise<SlideImage[]> {
  const slides: SlideImage[] = []
  const startedAt = Date.now()
  const tasks = timestamps.map((timestamp, index) => async () => {
    const outputPath = path.join(outputDir, `slide_${String(index + 1).padStart(4, '0')}.png`)
    const args = [
      '-hide_banner',
      '-ss',
      String(timestamp),
      '-i',
      inputPath,
      '-vframes',
      '1',
      '-q:v',
      '2',
      '-an',
      '-sn',
      outputPath,
    ]
    await runProcess({
      command: ffmpegPath,
      args,
      timeoutMs,
      errorLabel: 'ffmpeg',
    })
    return { index: index + 1, timestamp, imagePath: outputPath }
  })
  const results = await runWithConcurrency(tasks, workers)
  const ordered = results.filter(Boolean).sort((a, b) => a.index - b.index)
  for (const slide of ordered) {
    slides.push(slide)
  }
  logSlidesTiming(`extract frame loop (count=${timestamps.length}, workers=${workers})`, startedAt)
  return slides
}

type CropRect = { x: number; y: number; width: number; height: number }

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function resolveCropFromRoi(
  roi: SlideRoi,
  videoInfo: { width: number | null; height: number | null }
): CropRect | null {
  if (!videoInfo.width || !videoInfo.height) return null
  const x = Math.round(roi.x * videoInfo.width)
  const y = Math.round(roi.y * videoInfo.height)
  const width = Math.round(roi.width * videoInfo.width)
  const height = Math.round(roi.height * videoInfo.height)
  if (width < 16 || height < 16) return null
  const safeX = clamp(x, 0, videoInfo.width - 1)
  const safeY = clamp(y, 0, videoInfo.height - 1)
  const safeWidth = clamp(width, 16, videoInfo.width - safeX)
  const safeHeight = clamp(height, 16, videoInfo.height - safeY)
  return { x: safeX, y: safeY, width: safeWidth, height: safeHeight }
}

async function detectSlideRoiWithLlm({
  ffmpegPath,
  inputPath,
  videoInfo,
  llm,
  warnings,
  timeoutMs,
}: {
  ffmpegPath: string
  inputPath: string
  videoInfo: { durationSeconds: number | null; width: number | null; height: number | null }
  llm?: SlideLlmConfig | null
  warnings: string[]
  timeoutMs: number
}): Promise<SlideRoi | null> {
  if (!llm || llm.attempts.length === 0) return null
  const timestamps = buildRoiSampleTimestamps(videoInfo.durationSeconds)
  if (timestamps.length === 0) return null

  const roiDir = await fs.mkdtemp(path.join(tmpdir(), `summarize-roi-${randomUUID()}-`))
  try {
    const framePaths: string[] = []
    for (let i = 0; i < timestamps.length; i += 1) {
      const outputPath = path.join(roiDir, `roi_${i + 1}.png`)
      await extractFrameForRoi({
        ffmpegPath,
        inputPath,
        timestamp: timestamps[i],
        outputPath,
        timeoutMs,
      })
      framePaths.push(outputPath)
    }

    const { roi, modelId } = await inferSlideRoiFromFrames({
      framePaths,
      llm,
      warnings,
      timeoutMs,
    })
    if (roi && modelId) {
      warnings.push(`LLM ROI model ${modelId} selected for slide tuning`)
    }
    return roi
  } catch (error) {
    warnings.push(`LLM ROI detection failed: ${String(error)}`)
    return null
  } finally {
    await fs.rm(roiDir, { recursive: true, force: true })
  }
}

function buildRoiSampleTimestamps(durationSeconds: number | null): number[] {
  if (!durationSeconds || durationSeconds <= 0) return [0]
  const points = [0.12, 0.5, 0.85]
  return points.map((ratio) => clamp(durationSeconds * ratio, 0, durationSeconds - 0.1))
}

async function extractFrameForRoi({
  ffmpegPath,
  inputPath,
  timestamp,
  outputPath,
  timeoutMs,
}: {
  ffmpegPath: string
  inputPath: string
  timestamp: number
  outputPath: string
  timeoutMs: number
}): Promise<void> {
  const args = [
    '-hide_banner',
    '-ss',
    String(timestamp),
    '-i',
    inputPath,
    '-vframes',
    '1',
    '-vf',
    'scale=960:-2',
    '-q:v',
    '2',
    '-an',
    '-sn',
    outputPath,
  ]
  await runProcess({
    command: ffmpegPath,
    args,
    timeoutMs,
    errorLabel: 'ffmpeg',
  })
}

async function inferSlideRoiFromFrames({
  framePaths,
  llm,
  warnings,
  timeoutMs,
}: {
  framePaths: string[]
  llm: SlideLlmConfig
  warnings: string[]
  timeoutMs: number
}): Promise<{ roi: SlideRoi | null; modelId: string | null }> {
  for (const attempt of llm.attempts) {
    const apiKeysForAttempt = {
      xaiApiKey: llm.apiKeys.xaiApiKey,
      openaiApiKey: attempt.openaiApiKeyOverride ?? llm.apiKeys.openaiApiKey,
      googleApiKey: llm.keyFlags.googleConfigured ? llm.apiKeys.googleApiKey : null,
      anthropicApiKey: llm.keyFlags.anthropicConfigured ? llm.apiKeys.anthropicApiKey : null,
      openrouterApiKey: llm.keyFlags.openrouterConfigured ? llm.apiKeys.openrouterApiKey : null,
    }
    if (!hasApiKeyForAttempt(attempt, llm, apiKeysForAttempt)) continue

    let lastRoi: SlideRoi | null = null
    const rois: SlideRoi[] = []
    for (const framePath of framePaths) {
      const roi = await inferSlideRoiFromFrame({
        attempt,
        framePath,
        llm,
        apiKeysForAttempt,
        warnings,
        timeoutMs,
      })
      if (roi) {
        rois.push(roi)
        lastRoi = roi
      }
    }
    const merged = mergeRois(rois)
    if (merged) return { roi: merged, modelId: attempt.userModelId }
    if (lastRoi) return { roi: lastRoi, modelId: attempt.userModelId }
  }
  warnings.push('No LLM ROI model succeeded; continuing without ROI.')
  return { roi: null, modelId: null }
}

function hasApiKeyForAttempt(
  attempt: SlideLlmConfig['attempts'][number],
  llm: SlideLlmConfig,
  apiKeysForAttempt: {
    xaiApiKey: string | null
    openaiApiKey: string | null
    googleApiKey: string | null
    anthropicApiKey: string | null
    openrouterApiKey: string | null
  }
): boolean {
  if (attempt.requiredEnv === 'GEMINI_API_KEY') return llm.keyFlags.googleConfigured
  if (attempt.requiredEnv === 'ANTHROPIC_API_KEY') return llm.keyFlags.anthropicConfigured
  if (attempt.requiredEnv === 'OPENROUTER_API_KEY') return llm.keyFlags.openrouterConfigured
  if (attempt.requiredEnv === 'XAI_API_KEY') return Boolean(apiKeysForAttempt.xaiApiKey)
  if (attempt.requiredEnv === 'Z_AI_API_KEY') return Boolean(llm.apiKeys.zaiApiKey)
  return Boolean(apiKeysForAttempt.openaiApiKey)
}

async function inferSlideRoiFromFrame({
  attempt,
  framePath,
  llm,
  apiKeysForAttempt,
  warnings,
  timeoutMs,
}: {
  attempt: SlideLlmConfig['attempts'][number]
  framePath: string
  llm: SlideLlmConfig
  apiKeysForAttempt: {
    xaiApiKey: string | null
    openaiApiKey: string | null
    googleApiKey: string | null
    anthropicApiKey: string | null
    openrouterApiKey: string | null
  }
  warnings: string[]
  timeoutMs: number
}): Promise<SlideRoi | null> {
  const bytes = await fs.readFile(framePath)
  const prompt = buildRoiPrompt(bytes)
  const forceChatCompletions =
    Boolean(attempt.forceChatCompletions) ||
    (llm.openaiUseChatCompletions && attempt.llmModelId.startsWith('openai/'))

  try {
    const result = await generateTextWithModelId({
      modelId: attempt.llmModelId,
      apiKeys: apiKeysForAttempt,
      prompt,
      temperature: 0,
      maxOutputTokens: 200,
      timeoutMs,
      fetchImpl: llm.fetchImpl,
      forceOpenRouter: attempt.forceOpenRouter,
      openaiBaseUrlOverride: attempt.openaiBaseUrlOverride ?? llm.providerBaseUrls.openai,
      anthropicBaseUrlOverride: llm.providerBaseUrls.anthropic,
      googleBaseUrlOverride: llm.providerBaseUrls.google,
      xaiBaseUrlOverride: llm.providerBaseUrls.xai,
      forceChatCompletions,
      retries: 1,
    })
    return parseSlideRoi(result.text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (llm.verbose) {
      warnings.push(`ROI model ${attempt.userModelId} failed: ${message}`)
    }
    return null
  }
}

function buildRoiPrompt(imageBytes: Uint8Array): Prompt {
  return {
    system: 'You are a vision assistant. Return ONLY JSON or null. No extra text.',
    userText:
      'Find the rectangular region that contains the main slide content while excluding any live speaker video inset or webcam box. Reply with JSON: {"x":0-1,"y":0-1,"width":0-1,"height":0-1,"confidence":0-1}. If unsure, reply null.',
    attachments: [
      {
        kind: 'image',
        mediaType: 'image/png',
        bytes: imageBytes,
        filename: 'slide.png',
      },
    ],
  }
}

function parseSlideRoi(text: string): SlideRoi | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed === 'null') return null
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    const x = normalizeRoiValue(parsed.x ?? parsed.left)
    const y = normalizeRoiValue(parsed.y ?? parsed.top)
    const width = normalizeRoiValue(parsed.width ?? parsed.w)
    const height = normalizeRoiValue(parsed.height ?? parsed.h)
    const right = normalizeRoiValue(parsed.right)
    const bottom = normalizeRoiValue(parsed.bottom)
    const finalWidth = width ?? (right != null && x != null ? right - x : null)
    const finalHeight = height ?? (bottom != null && y != null ? bottom - y : null)
    if (
      x == null ||
      y == null ||
      finalWidth == null ||
      finalHeight == null ||
      finalWidth <= 0 ||
      finalHeight <= 0
    ) {
      return null
    }
    const roi = {
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
      width: clamp(finalWidth, 0, 1),
      height: clamp(finalHeight, 0, 1),
    }
    if (roi.width < 0.2 || roi.height < 0.2) return null
    return roi
  } catch {
    return null
  }
}

function normalizeRoiValue(value: unknown): number | null {
  if (value == null) return null
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric > 1 && numeric <= 100) return numeric / 100
  return numeric
}

function mergeRois(rois: SlideRoi[]): SlideRoi | null {
  if (rois.length === 0) return null
  const sorted = [...rois]
  const pickMedian = (values: number[]) => {
    const list = [...values].sort((a, b) => a - b)
    return list[Math.floor(list.length / 2)] ?? 0.5
  }
  const xs = sorted.map((roi) => roi.x)
  const ys = sorted.map((roi) => roi.y)
  const ws = sorted.map((roi) => roi.width)
  const hs = sorted.map((roi) => roi.height)
  return {
    x: pickMedian(xs),
    y: pickMedian(ys),
    width: pickMedian(ws),
    height: pickMedian(hs),
  }
}

function roundThreshold(value: number): number {
  return Math.round(value * 100) / 100
}

function buildSegments(
  durationSeconds: number | null,
  workers: number
): Array<{ start: number; duration: number }> {
  if (!durationSeconds || durationSeconds <= 0 || workers <= 1) {
    return [{ start: 0, duration: durationSeconds ?? 0 }]
  }
  const clampedWorkers = Math.max(1, Math.min(16, Math.round(workers)))
  const segmentCount = Math.min(clampedWorkers, Math.ceil(durationSeconds / 60))
  const segmentDuration = durationSeconds / segmentCount
  const segments: Array<{ start: number; duration: number }> = []
  for (let i = 0; i < segmentCount; i += 1) {
    const start = i * segmentDuration
    const remaining = durationSeconds - start
    const duration = i === segmentCount - 1 ? remaining : segmentDuration
    segments.push({ start, duration })
  }
  return segments
}

async function detectSceneTimestampsAdaptive({
  ffmpegPath,
  inputPath,
  threshold,
  minThreshold,
  targetMinSlides,
  timeoutMs,
  crop,
  warnings,
  durationSeconds,
  workers,
}: {
  ffmpegPath: string
  inputPath: string
  threshold: number
  minThreshold: number
  targetMinSlides: number
  timeoutMs: number
  crop: CropRect | null
  warnings: string[]
  durationSeconds: number | null
  workers: number
}): Promise<{ threshold: number; timestamps: number[]; confidence: number }> {
  const segments = buildSegments(durationSeconds, workers)
  const detectOnce = async (value: number) =>
    detectSceneTimestamps({
      ffmpegPath,
      inputPath,
      threshold: value,
      crop,
      timeoutMs,
      segments,
      workers,
    })

  const baseStart = Date.now()
  let chosen = threshold
  let timestamps = await detectOnce(chosen)
  logSlidesTiming(
    `scene detection base (threshold=${chosen}, segments=${segments.length})`,
    baseStart
  )

  if (timestamps.length < targetMinSlides && chosen > minThreshold) {
    const retryThreshold = Math.max(minThreshold, roundThreshold(chosen * 0.5))
    if (retryThreshold !== chosen) {
      const retryStart = Date.now()
      const retry = await detectOnce(retryThreshold)
      logSlidesTiming(
        `scene detection retry (threshold=${retryThreshold}, segments=${segments.length})`,
        retryStart
      )
      if (retry.length > timestamps.length) {
        chosen = retryThreshold
        timestamps = retry
      }
    }
  }

  if (timestamps.length === 0) {
    warnings.push('Scene detection did not find any candidate slide changes.')
  }

  const confidence = clamp(timestamps.length / Math.max(1, targetMinSlides), 0, 1)
  return { threshold: chosen, timestamps, confidence }
}

async function detectSceneTimestamps({
  ffmpegPath,
  inputPath,
  threshold,
  crop,
  timeoutMs,
  segments,
  workers,
}: {
  ffmpegPath: string
  inputPath: string
  threshold: number
  crop: { x: number; y: number; width: number; height: number } | null
  timeoutMs: number
  segments?: Array<{ start: number; duration: number }>
  workers?: number
}): Promise<number[]> {
  const cropFilter = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}` : null
  const filter = cropFilter
    ? `${cropFilter},select='gt(scene,${threshold})',showinfo`
    : `select='gt(scene,${threshold})',showinfo`
  const defaultSegments = [{ start: 0, duration: 0 }]
  const usedSegments = segments && segments.length > 0 ? segments : defaultSegments
  const concurrency = workers && workers > 0 ? workers : 1

  const tasks = usedSegments.map((segment) => async () => {
    const args = [
      '-hide_banner',
      ...(segment.duration > 0
        ? ['-ss', String(segment.start), '-t', String(segment.duration)]
        : []),
      '-i',
      inputPath,
      '-vf',
      filter,
      '-vsync',
      'vfr',
      '-an',
      '-sn',
      '-f',
      'null',
      '-',
    ]
    const timestamps: number[] = []
    await runProcess({
      command: ffmpegPath,
      args,
      timeoutMs: Math.max(timeoutMs, FFMPEG_TIMEOUT_FALLBACK_MS),
      errorLabel: 'ffmpeg',
      onStderrLine: (line) => {
        const ts = parseShowinfoTimestamp(line)
        if (ts != null) timestamps.push(ts + segment.start)
      },
    })
    return timestamps
  })

  const results = await runWithConcurrency(tasks, concurrency)
  const merged = results.flat()
  merged.sort((a, b) => a - b)
  return merged
}

async function probeVideoInfo({
  ffprobePath,
  env,
  inputPath,
  timeoutMs,
}: {
  ffprobePath: string | null
  env: Record<string, string | undefined>
  inputPath: string
  timeoutMs: number
}): Promise<{ durationSeconds: number | null; width: number | null; height: number | null }> {
  const probeBin = ffprobePath ?? resolveExecutableInPath('ffprobe', env)
  if (!probeBin) return { durationSeconds: null, width: null, height: null }
  const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', inputPath]
  try {
    const output = await runProcessCapture({
      command: probeBin,
      args,
      timeoutMs: Math.min(timeoutMs, 30_000),
      errorLabel: 'ffprobe',
    })
    const parsed = JSON.parse(output) as {
      streams?: Array<{
        codec_type?: string
        duration?: string | number
        width?: number
        height?: number
      }>
      format?: { duration?: string | number }
    }
    let durationSeconds: number | null = null
    let width: number | null = null
    let height: number | null = null
    for (const stream of parsed.streams ?? []) {
      if (stream.codec_type === 'video') {
        if (width == null && typeof stream.width === 'number') width = stream.width
        if (height == null && typeof stream.height === 'number') height = stream.height
        const duration = Number(stream.duration)
        if (Number.isFinite(duration) && duration > 0) durationSeconds = duration
      }
    }
    if (durationSeconds == null) {
      const formatDuration = Number(parsed.format?.duration)
      if (Number.isFinite(formatDuration) && formatDuration > 0) durationSeconds = formatDuration
    }
    return { durationSeconds, width, height }
  } catch {
    return { durationSeconds: null, width: null, height: null }
  }
}

async function runProcess({
  command,
  args,
  timeoutMs,
  errorLabel,
  onStderrLine,
}: {
  command: string
  args: string[]
  timeoutMs: number
  errorLabel: string
  onStderrLine?: (line: string) => void
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let stderrBuffer = ''

    const flushLine = (line: string) => {
      if (onStderrLine) onStderrLine(line)
      if (stderr.length < 8192) {
        stderr += line
        if (!line.endsWith('\n')) stderr += '\n'
      }
    }

    if (proc.stderr) {
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        stderrBuffer += chunk
        const lines = stderrBuffer.split(/\r?\n/)
        stderrBuffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line) flushLine(line)
        }
      })
    }

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`${errorLabel} timed out`))
    }, timeoutMs)

    proc.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    proc.on('close', (code) => {
      clearTimeout(timeout)
      if (stderrBuffer.trim().length > 0) {
        flushLine(stderrBuffer.trim())
      }
      if (code === 0) {
        resolve()
        return
      }
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : ''
      reject(new Error(`${errorLabel} exited with code ${code}${suffix}`))
    })
  })
}

function applyMinDurationFilter(
  slides: SlideImage[],
  minDurationSeconds: number,
  warnings: string[]
): SlideImage[] {
  if (minDurationSeconds <= 0) return slides
  const filtered: SlideImage[] = []
  let lastTimestamp = -Infinity
  for (const slide of slides) {
    if (slide.timestamp - lastTimestamp >= minDurationSeconds) {
      filtered.push(slide)
      lastTimestamp = slide.timestamp
    } else {
      void fs.rm(slide.imagePath, { force: true })
    }
  }
  if (filtered.length < slides.length) {
    warnings.push(`Filtered ${slides.length - filtered.length} slides by min duration`)
  }
  return filtered.map((slide, index) => ({ ...slide, index: index + 1 }))
}

function mergeTimestamps(
  sceneTimestamps: number[],
  intervalTimestamps: number[],
  minDurationSeconds: number
): number[] {
  const merged = [...sceneTimestamps, ...intervalTimestamps].filter((value) =>
    Number.isFinite(value)
  )
  merged.sort((a, b) => a - b)
  if (merged.length === 0) return []
  const result: number[] = []
  const minGap = Math.max(0.1, minDurationSeconds * 0.5)
  for (const ts of merged) {
    if (result.length === 0 || ts - result[result.length - 1] >= minGap) {
      result.push(ts)
    }
  }
  return result
}

async function runProcessCapture({
  command,
  args,
  timeoutMs,
  errorLabel,
}: {
  command: string
  args: string[]
  timeoutMs: number
  errorLabel: string
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`${errorLabel} timed out`))
    }, timeoutMs)

    if (proc.stdout) {
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })
    }
    if (proc.stderr) {
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        if (stderr.length < 8192) {
          stderr += chunk
        }
      })
    }

    proc.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    proc.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve(stdout)
        return
      }
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : ''
      reject(new Error(`${errorLabel} exited with code ${code}${suffix}`))
    })
  })
}

function applyMaxSlidesFilter(
  slides: SlideImage[],
  maxSlides: number,
  warnings: string[]
): SlideImage[] {
  if (maxSlides <= 0 || slides.length <= maxSlides) return slides
  const kept = slides.slice(0, maxSlides)
  const removed = slides.slice(maxSlides)
  for (const slide of removed) {
    if (slide.imagePath) {
      void fs.rm(slide.imagePath, { force: true })
    }
  }
  warnings.push(`Trimmed slides to max ${maxSlides}`)
  return kept.map((slide, index) => ({ ...slide, index: index + 1 }))
}

async function renameSlidesWithTimestamps(
  slides: SlideImage[],
  slidesDir: string
): Promise<SlideImage[]> {
  const renamed: SlideImage[] = []
  for (const slide of slides) {
    const timestampLabel = slide.timestamp.toFixed(2)
    const filename = `slide_${slide.index.toString().padStart(4, '0')}_${timestampLabel}s.png`
    const nextPath = path.join(slidesDir, filename)
    if (slide.imagePath !== nextPath) {
      await fs.rename(slide.imagePath, nextPath).catch(async () => {
        await fs.copyFile(slide.imagePath, nextPath)
        await fs.rm(slide.imagePath, { force: true })
      })
    }
    renamed.push({ ...slide, imagePath: nextPath })
  }
  return renamed
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  workers: number
): Promise<T[]> {
  if (tasks.length === 0) return []
  const concurrency = Math.max(1, Math.min(16, Math.round(workers)))
  const results: T[] = new Array(tasks.length)
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const current = nextIndex
      if (current >= tasks.length) return
      nextIndex += 1
      results[current] = await tasks[current]()
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
  await Promise.all(runners)
  return results
}

async function runOcrOnSlides(
  slides: SlideImage[],
  tesseractPath: string,
  workers: number
): Promise<SlideImage[]> {
  const tasks = slides.map((slide) => async () => {
    try {
      const text = await runTesseract(tesseractPath, slide.imagePath)
      const cleaned = cleanOcrText(text)
      return {
        ...slide,
        ocrText: cleaned,
        ocrConfidence: estimateOcrConfidence(cleaned),
      }
    } catch {
      return { ...slide, ocrText: '', ocrConfidence: 0 }
    }
  })
  const results = await runWithConcurrency(tasks, workers)
  return results.sort((a, b) => a.index - b.index)
}

async function runTesseract(tesseractPath: string, imagePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [imagePath, 'stdout', '--oem', '3', '--psm', '6']
    const proc = spawn(tesseractPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('tesseract timed out'))
    }, TESSERACT_TIMEOUT_MS)

    if (proc.stdout) {
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })
    }
    if (proc.stderr) {
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        if (stderr.length < 8192) {
          stderr += chunk
        }
      })
    }

    proc.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    proc.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve(stdout)
        return
      }
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : ''
      reject(new Error(`tesseract exited with code ${code}${suffix}`))
    })
  })
}

function cleanOcrText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 2)
    .filter((line) => !(line.length > 20 && !line.includes(' ')))
    .filter((line) => /[a-z0-9]/i.test(line))
  return lines.join('\n')
}

function estimateOcrConfidence(text: string): number {
  if (!text) return 0
  const total = text.length
  if (total === 0) return 0
  const alnum = Array.from(text).filter((char) => /[a-z0-9]/i.test(char)).length
  return Math.min(1, alnum / total)
}

async function writeSlidesJson(result: SlideExtractionResult, slidesDir: string): Promise<void> {
  const payload = {
    sourceUrl: result.sourceUrl,
    sourceKind: result.sourceKind,
    sourceId: result.sourceId,
    slidesDir,
    sceneThreshold: result.sceneThreshold,
    autoTuneThreshold: result.autoTuneThreshold,
    autoTune: result.autoTune,
    maxSlides: result.maxSlides,
    minSlideDuration: result.minSlideDuration,
    ocrRequested: result.ocrRequested,
    ocrAvailable: result.ocrAvailable,
    slideCount: result.slides.length,
    warnings: result.warnings,
    slides: result.slides,
  }
  await fs.writeFile(path.join(slidesDir, 'slides.json'), JSON.stringify(payload, null, 2), 'utf8')
}

function buildDirectSourceId(url: string): string {
  const parsed = (() => {
    try {
      return new URL(url)
    } catch {
      return null
    }
  })()
  const rawName = parsed ? path.basename(parsed.pathname) : 'video'
  const base = rawName.replace(/\.[a-z0-9]+$/i, '').trim() || 'video'
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 8)
  return slug ? `${slug}-${hash}` : `video-${hash}`
}
