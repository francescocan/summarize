import { splitStatusPercent } from '../../lib/status'
import type { PanelPhase } from './types'

type HeaderState = {
  phase: PanelPhase
  summaryFromCache: boolean | null
}

export type HeaderController = {
  setBaseTitle: (text: string) => void
  setBaseSubtitle: (text: string) => void
  setStatus: (text: string) => void
  armProgress: () => void
  stopProgress: () => void
  updateHeaderOffset: () => void
}

export function createHeaderController({
  headerEl,
  titleEl,
  subtitleEl,
  progressFillEl,
  getState,
}: {
  headerEl: HTMLElement
  titleEl: HTMLElement
  subtitleEl: HTMLElement
  progressFillEl: HTMLElement
  getState: () => HeaderState
}): HeaderController {
  let baseTitle = 'Summarize'
  let baseSubtitle = ''
  let statusText = ''
  let showProgress = false

  const updateHeader = () => {
    const { phase } = getState()
    const isStreaming = phase === 'connecting' || phase === 'streaming'
    const trimmed = statusText.trim()
    const showStatus = trimmed.length > 0
    const split = showStatus
      ? splitStatusPercent(trimmed)
      : { text: '', percent: null as string | null }
    const percentNum = split.percent ? Number.parseInt(split.percent, 10) : null
    const isError =
      showStatus &&
      (trimmed.toLowerCase().startsWith('error:') || trimmed.toLowerCase().includes(' error'))
    const isRunning = showProgress && !isError
    const shouldShowStatus = showStatus && (!isStreaming || !baseSubtitle)

    titleEl.textContent = baseTitle
    headerEl.classList.toggle('isError', isError)
    headerEl.classList.toggle('isRunning', isRunning)
    headerEl.classList.toggle('isIndeterminate', isRunning && percentNum == null)

    if (
      !isError &&
      percentNum != null &&
      Number.isFinite(percentNum) &&
      percentNum >= 0 &&
      percentNum <= 100
    ) {
      headerEl.style.setProperty('--progress', `${percentNum}%`)
    } else {
      headerEl.style.setProperty('--progress', '0%')
    }

    progressFillEl.style.display = isRunning || isError ? '' : 'none'
    subtitleEl.textContent = isError
      ? split.text || trimmed
      : shouldShowStatus
        ? split.text || trimmed
        : baseSubtitle
  }

  const updateHeaderOffset = () => {
    const height = headerEl.getBoundingClientRect().height
    document.documentElement.style.setProperty('--header-height', `${height}px`)
  }

  const setBaseSubtitle = (text: string) => {
    baseSubtitle = text
    updateHeader()
  }

  const setBaseTitle = (text: string) => {
    const next = text.trim() || 'Summarize'
    baseTitle = next
    updateHeader()
  }

  const setStatus = (text: string) => {
    statusText = text
    const trimmed = text.trim()
    const isError =
      trimmed.length > 0 &&
      (trimmed.toLowerCase().startsWith('error:') || trimmed.toLowerCase().includes(' error'))
    const split = splitStatusPercent(text)
    const { summaryFromCache } = getState()
    if (split.percent && summaryFromCache !== true) {
      armProgress()
    } else if (trimmed && summaryFromCache !== true && !isError) {
      armProgress()
    } else if (!trimmed && !(phase === 'connecting' || phase === 'streaming')) {
      stopProgress()
    }
    updateHeader()
  }

  const armProgress = () => {
    if (getState().summaryFromCache === true) return
    if (showProgress) return
    showProgress = true
    updateHeader()
  }

  const stopProgress = () => {
    if (!showProgress) return
    showProgress = false
    updateHeader()
  }

  return {
    setBaseTitle,
    setBaseSubtitle,
    setStatus,
    armProgress,
    stopProgress,
    updateHeaderOffset,
  }
}
