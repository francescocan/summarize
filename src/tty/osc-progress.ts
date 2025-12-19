import {
  startOscProgress as startOscProgressImpl,
  supportsOscProgress as supportsOscProgressImpl,
} from 'osc-progress'

export type { OscProgressOptions } from 'osc-progress'

export function startOscProgress(options: import('osc-progress').OscProgressOptions) {
  return startOscProgressImpl(options)
}

export function supportsOscProgress(env: Record<string, string | undefined>, isTty: boolean) {
  return supportsOscProgressImpl(env, isTty)
}
