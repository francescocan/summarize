import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import { startSpinner } from '../src/tty/spinner.js'

const { oraMock } = vi.hoisted(() => ({
  oraMock: vi.fn(),
}))

vi.mock('ora', () => ({
  default: oraMock,
}))

const stream = new Writable({
  write(_chunk, _encoding, callback) {
    callback()
  },
})

describe('tty spinner', () => {
  it('returns no-op handlers when disabled', () => {
    oraMock.mockReset()

    const spinner = startSpinner({ text: 'Loading', enabled: false, stream })
    spinner.stop()
    spinner.clear()
    spinner.stopAndClear()
    spinner.setText('Next')

    expect(oraMock).not.toHaveBeenCalled()
  })

  it('does not stop when already stopped', () => {
    oraMock.mockReset()
    const stopSpy = vi.fn()
    oraMock.mockImplementationOnce(() => ({
      isSpinning: false,
      text: 'Loading',
      stop: stopSpy,
      clear: vi.fn(),
      start() {
        return this
      },
    }))

    const spinner = startSpinner({ text: 'Loading', enabled: true, stream })
    spinner.stop()

    expect(stopSpy).not.toHaveBeenCalled()
  })
})
