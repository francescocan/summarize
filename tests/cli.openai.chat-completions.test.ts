import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import { runCli } from '../src/run.js'

const htmlResponse = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html' },
  })

const generateTextMock = vi.fn(async () => ({ text: 'OK' }))

vi.mock('ai', () => ({
  generateText: generateTextMock,
}))

const createOpenAIMock = vi.fn(() => {
  const responsesModel = (_modelId: string) => ({ kind: 'responses' })
  const chatModel = (_modelId: string) => ({ kind: 'chat' })
  return Object.assign(responsesModel, { chat: chatModel })
})

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: createOpenAIMock,
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => (_modelId: string) => ({}),
}))

vi.mock('@ai-sdk/xai', () => ({
  createXai: () => (_modelId: string) => ({}),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => (_modelId: string) => ({}),
}))

const silentStderr = new Writable({
  write(_chunk, _encoding, callback) {
    callback()
  },
})

const collectStdout = () => {
  let text = ''
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString()
      callback()
    },
  })
  return { stdout, getText: () => text }
}

describe('OpenAI chat completions toggle', () => {
  it('forces chat completions via OPENAI_USE_CHAT_COMPLETIONS', async () => {
    generateTextMock.mockReset().mockResolvedValue({ text: 'OK' })
    createOpenAIMock.mockClear()

    const html =
      '<!doctype html><html><head><title>Hello</title></head>' +
      '<body><article><p>Hi</p></article></body></html>'

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url
      if (url === 'https://example.com') return htmlResponse(html)
      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const out = collectStdout()
    await runCli(['--model', 'openai/gpt-5.2', '--timeout', '2s', 'https://example.com'], {
      env: { OPENAI_API_KEY: 'test', OPENAI_USE_CHAT_COMPLETIONS: '1' },
      fetch: fetchMock as unknown as typeof fetch,
      stdout: out.stdout,
      stderr: silentStderr,
    })

    const args = generateTextMock.mock.calls[0]?.[0] as { model?: { kind?: string } }
    expect(args.model?.kind).toBe('chat')
  })

  it('forces chat completions via config', async () => {
    generateTextMock.mockReset().mockResolvedValue({ text: 'OK' })
    createOpenAIMock.mockClear()

    const html =
      '<!doctype html><html><head><title>Hello</title></head>' +
      '<body><article><p>Hi</p></article></body></html>'

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url
      if (url === 'https://example.com') return htmlResponse(html)
      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const tempRoot = mkdtempSync(join(tmpdir(), 'summarize-openai-chat-'))
    const configDir = join(tempRoot, '.summarize')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ openai: { useChatCompletions: true } }),
      'utf8'
    )

    const out = collectStdout()
    await runCli(['--model', 'openai/gpt-5.2', '--timeout', '2s', 'https://example.com'], {
      env: { HOME: tempRoot, OPENAI_API_KEY: 'test' },
      fetch: fetchMock as unknown as typeof fetch,
      stdout: out.stdout,
      stderr: silentStderr,
    })

    const args = generateTextMock.mock.calls[0]?.[0] as { model?: { kind?: string } }
    expect(args.model?.kind).toBe('chat')
  })
})
