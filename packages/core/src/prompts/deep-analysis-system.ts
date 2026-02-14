import type { OutputLanguage } from '../language.js'
import { formatOutputLanguageInstruction } from '../language.js'
import { buildInstructions, buildTaggedPrompt, type PromptOverrides } from './format.js'

export const DEEP_ANALYSIS_SYSTEM_PROMPT = [
  'You are a Senior Technical Analyst and Subject Matter Expert.',
  'Your goal is to deconstruct a tutorial (article or video) into its most crystalline, actionable form while verifying its accuracy against the current 2026 landscape.',
  'Follow the user instructions in <instructions> exactly.',
  'Never mention sponsors, ads, or promos, or that they were skipped or ignored.',
  'Use Markdown with hierarchical headers (##, ###, ####).',
  'Use blockquote callout boxes (> **Warning:** or > **Pro-tip:**) for warnings and critical tips.',
  'Maintain a professional, objective, and low-noise tone throughout.',
  'Quotation marks are allowed; use straight quotes only (no curly quotes).',
  'Do not use emojis.',
].join('\n')

export function buildDeepAnalysisPrompt({
  url,
  title,
  siteName,
  description,
  content,
  truncated,
  hasTranscript,
  outputLanguage,
  promptOverride,
  languageInstruction,
}: {
  url: string
  title: string | null
  siteName: string | null
  description: string | null
  content: string
  truncated: boolean
  hasTranscript: boolean
  outputLanguage?: OutputLanguage | null
  promptOverride?: string | null
  languageInstruction?: string | null
}): string {
  const contextLines: string[] = [`Source URL: ${url}`]

  if (title) {
    contextLines.push(`Page name: ${title}`)
  }

  if (siteName) {
    contextLines.push(`Site: ${siteName}`)
  }

  if (description) {
    contextLines.push(`Page description: ${description}`)
  }

  if (truncated) {
    contextLines.push('Note: Content truncated to the first portion available.')
  }

  const contextHeader = contextLines.join('\n')

  const contentType = hasTranscript ? 'video tutorial transcript' : 'article/tutorial'

  const baseInstructions = [
    `You are analyzing a ${contentType}. Perform all four phases below in order.`,
    '',
    '## Phase 1: Contextual Grounding (The "Knowledge Sync")',
    'Before analyzing the provided content, identify the "Current State of the Art" for the topic discussed. Based solely on your training knowledge, identify:',
    '- Latest tools, versions, or methodologies as of 2026.',
    '- Common pitfalls or "rookie mistakes" associated with this process.',
    '- Standard benchmarks for success in this specific task.',
    'Present this as a concise grounding section so the reader understands the current landscape.',
    '',
    '## Phase 2: The Deconstruction (Removing Fluff)',
    'Analyze the provided content. Strip away all marketing hype, repetitive anecdotes, and filler. Extract only the structural essence:',
    '- **The Objective:** What is the specific, measurable end-result?',
    '- **The Prerequisites:** What tools, skills, or data are needed before step one?',
    '- **The Architecture:** The fundamental basics or logic that makes this process work.',
    '',
    '## Phase 3: Step-by-Step Blueprint',
    'Create a granular, chronological tutorial. Each step must be:',
    '- **Action-Oriented:** Start with a verb.',
    '- **Detailed:** Include hidden steps the author might have glossed over.',
    '- **Validated:** If a step contradicts current 2026 best practices found in Phase 1, note the correction with a blockquote callout.',
    '',
    '## Phase 4: Critical Diagnostic',
    'Provide a balanced critical assessment:',
    '',
    '### Pros & Cons',
    'A Markdown table of why this method works vs. its limitations.',
    '',
    '### The "Clarity Gap" Analysis',
    'Explicitly list any citations, instructions, or technical explanations that are vague, logically inconsistent, or poorly explained in the source.',
    '',
    '### Research Proposals',
    'For every gap identified above, provide:',
    '1. A brief summary of what specific information is missing.',
    '2. A suggested search query that would help fill this gap.',
    '3. Why this research would improve the tutorial.',
    '',
    'Format each research proposal as a numbered item with the fields above clearly labeled.',
    'End with the line: "Reply **yes** to research these gaps using web search, or continue chatting about the analysis."',
    '',
    '---',
    'Hard rules: never mention sponsor/ads; use straight quotation marks only (no curly quotes).',
    formatOutputLanguageInstruction(outputLanguage ?? { kind: 'auto' }),
    'Base everything strictly on the provided content and your training knowledge. Clearly distinguish between what the source states and what you infer from general knowledge.',
    'Do not use emojis, disclaimers, or speculation beyond the identified gaps.',
    'Write in direct, factual language.',
    'Use Markdown with hierarchical headers. Use blockquote callout boxes for warnings and pro-tips.',
  ]
    .filter((line) => typeof line === 'string')
    .join('\n')

  const instructions = buildInstructions({
    base: baseInstructions,
    overrides: { promptOverride, lengthInstruction: null, languageInstruction } satisfies PromptOverrides,
  })

  const context = contextHeader

  return buildTaggedPrompt({
    instructions,
    context,
    content,
  })
}
