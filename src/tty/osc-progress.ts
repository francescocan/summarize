import {
  createOscProgressController as createOscProgressControllerImpl,
  startOscProgress as startOscProgressImpl,
  supportsOscProgress as supportsOscProgressImpl,
} from 'osc-progress'

export type {
  OscProgressController,
  OscProgressOptions,
  OscProgressSupportOptions,
  OscProgressTerminator,
} from 'osc-progress'

export const createOscProgressController = createOscProgressControllerImpl

export function startOscProgress(options: import('osc-progress').OscProgressOptions) {
  return startOscProgressImpl(options)
}

export function supportsOscProgress(
  env: Record<string, string | undefined>,
  isTty: boolean,
  options?: import('osc-progress').OscProgressSupportOptions
) {
  return supportsOscProgressImpl(env, isTty, options)
}
