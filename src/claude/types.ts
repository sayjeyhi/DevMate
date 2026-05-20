export interface ClaudeConfig {
  /** Absolute path to the claude CLI binary. */
  binaryPath: string
  /** Default timeout in milliseconds for subprocess calls. Default: 1200000 (20 min). */
  timeoutMs?: number
  /** Default model to pass via --model flag. Omit to use claude's own default. */
  model?: string
}

export interface AskOptions {
  /** Overrides ClaudeConfig.timeoutMs for this specific call. */
  timeoutMs?: number
  /** Overrides ClaudeConfig.model for this specific call. */
  model?: string
  /** Called periodically with all text lines generated so far. */
  onProgress?: (lines: string[]) => Promise<void>
  /** Working directory for the Claude subprocess. Defaults to process.cwd(). */
  cwd?: string
}
