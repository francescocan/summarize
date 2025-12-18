import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const runCliMock = vi.fn(async () => {})

vi.mock('../src/run.js', () => ({
  runCli: runCliMock,
}))

describe('cli main wiring', async () => {
  const { handlePipeErrors, runCliMain } = await import('../src/cli-main.js')

  it('sets exit code and prints error when runCli throws', async () => {
    runCliMock.mockReset().mockRejectedValue(new Error('boom'))

    let stderrText = ''
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrText += chunk.toString()
        callback()
      },
    })

    let exitCode: number | null = null
    await runCliMain({
      argv: [],
      env: {},
      fetch: globalThis.fetch.bind(globalThis),
      stdout: new Writable({
        write(_c, _e, cb) {
          cb()
        },
      }),
      stderr,
      exit: () => {},
      setExitCode: (code) => {
        exitCode = code
      },
    })

    expect(exitCode).toBe(1)
    expect(stderrText.trim()).toBe('boom')
  })

  it('strips ANSI control sequences from non-verbose errors', async () => {
    runCliMock
      .mockReset()
      .mockRejectedValue(
        new Error(
          [
            '\u001b[31mred\u001b[0m',
            '\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007',
            '\u001b]1337;SetUserVar=foo=YmFy\u001b\\ok\u001b\\',
            '\u001bXunknown',
          ].join(' ')
        )
      )

    let stderrText = ''
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrText += chunk.toString()
        callback()
      },
    })
    ;(stderr as unknown as { isTTY?: boolean }).isTTY = true

    let exitCode: number | null = null
    await runCliMain({
      argv: [],
      env: {},
      fetch: globalThis.fetch.bind(globalThis),
      stdout: new Writable({
        write(_c, _e, cb) {
          cb()
        },
      }),
      stderr,
      exit: () => {},
      setExitCode: (code) => {
        exitCode = code
      },
    })

    expect(exitCode).toBe(1)
    expect(stderrText.trim()).toBe('red link ok unknown')
  })

  it('exits with 0 on EPIPE', () => {
    const stream = new EventEmitter() as unknown as NodeJS.WritableStream
    let exited: number | null = null
    handlePipeErrors(stream, (code) => {
      exited = code
    })

    stream.emit('error', Object.assign(new Error('pipe'), { code: 'EPIPE' }))
    expect(exited).toBe(0)
  })

  it('rethrows non-EPIPE stream errors', () => {
    const stream = new EventEmitter() as unknown as NodeJS.WritableStream
    handlePipeErrors(stream, () => {})

    const handler = stream.listeners('error')[0]
    expect(handler).toBeTypeOf('function')

    const error = Object.assign(new Error('nope'), { code: 'NOPE' })
    expect(() => (handler as (error: unknown) => void)(error)).toThrow(error)
  })
})
