export type SlideSourceKind = 'youtube' | 'direct'

export type SlideSource = {
  url: string
  kind: SlideSourceKind
  sourceId: string
}

export type SlideImage = {
  index: number
  timestamp: number
  imagePath: string
  ocrText?: string | null
  ocrConfidence?: number | null
}

export type SlideRoi = {
  x: number
  y: number
  width: number
  height: number
}

export type SlideAutoTune = {
  enabled: boolean
  chosenThreshold: number
  confidence: number
  strategy: 'hash' | 'llm-roi' | 'none'
  roi?: SlideRoi | null
}

export type SlideLlmAttempt = {
  transport: 'native' | 'openrouter'
  userModelId: string
  llmModelId: string
  forceOpenRouter: boolean
  requiredEnv:
    | 'XAI_API_KEY'
    | 'OPENAI_API_KEY'
    | 'GEMINI_API_KEY'
    | 'ANTHROPIC_API_KEY'
    | 'OPENROUTER_API_KEY'
    | 'Z_AI_API_KEY'
  openaiBaseUrlOverride?: string | null
  openaiApiKeyOverride?: string | null
  forceChatCompletions?: boolean
}

export type SlideLlmConfig = {
  attempts: SlideLlmAttempt[]
  timeoutMs: number
  fetchImpl: typeof fetch
  openaiUseChatCompletions: boolean
  apiKeys: {
    xaiApiKey: string | null
    openaiApiKey: string | null
    googleApiKey: string | null
    anthropicApiKey: string | null
    openrouterApiKey: string | null
    zaiApiKey: string | null
    zaiBaseUrl: string
  }
  providerBaseUrls: {
    openai: string | null
    anthropic: string | null
    google: string | null
    xai: string | null
  }
  keyFlags: {
    googleConfigured: boolean
    anthropicConfigured: boolean
    openrouterConfigured: boolean
  }
  verbose: boolean
  verboseColor: boolean
}

export type SlideExtractionResult = {
  sourceUrl: string
  sourceKind: SlideSourceKind
  sourceId: string
  slidesDir: string
  sceneThreshold: number
  autoTuneThreshold: boolean
  autoTune: SlideAutoTune
  maxSlides: number
  minSlideDuration: number
  ocrRequested: boolean
  ocrAvailable: boolean
  slides: SlideImage[]
  warnings: string[]
}
