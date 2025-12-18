import { homedir } from 'node:os'
import { join } from 'node:path'

let summarizeHomeDirOverride: string | null = null

/**
 * Test-only hook: avoid mutating process.env (shared across Vitest worker threads).
 * This override is scoped to the current Node worker.
 */
export function setSummarizeHomeDirOverrideForTest(dir: string | null): void {
  summarizeHomeDirOverride = dir
}

export function getSummarizeHomeDir(env: Record<string, string | undefined>): string {
  if (summarizeHomeDirOverride) return summarizeHomeDirOverride
  const fromEnv = env.SUMMARIZE_HOME_DIR?.trim()
  if (fromEnv) return fromEnv
  const home = env.HOME?.trim() || homedir()
  return join(home, '.summarize')
}

