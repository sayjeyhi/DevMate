import { ClaudeTimeoutError, ClaudeExitError } from '../shared/errors'
import type { ClaudeConfig, AskOptions } from './types'

interface Logger {
  info(data: Record<string, unknown>): void
}

interface BunSubprocess {
  stdin: { write(data: string): void; end(): void }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exitCode: number | null
  exited: Promise<number>
  kill(signal: NodeJS.Signals): void
}

declare const Bun: {
  spawn(
    args: string[],
    opts: { stdin: 'pipe'; stdout: 'pipe'; stderr: 'pipe'; env: Record<string, string | undefined> },
  ): BunSubprocess
  sleep(ms: number): Promise<void>
}

export class ClaudeClient {
  constructor(
    private readonly config: ClaudeConfig,
    private readonly logger: Logger,
  ) {}

  async ask(prompt: string, options?: AskOptions): Promise<string> {
    const effectiveTimeoutMs = options?.timeoutMs ?? this.config.timeoutMs ?? 30000
    const effectiveModel = options?.model ?? this.config.model

    const args = [
      this.config.binaryPath,
      '--print',
      '--dangerously-skip-permissions',
      '--output-format',
      'json',
    ]
    if (effectiveModel) {
      args.push('--model', effectiveModel)
    }

    const clonedEnv: Record<string, string | undefined> = { ...process.env }
    delete clonedEnv.CLAUDECODE

    this.logger.info({ event: 'claude_spawn', binary: this.config.binaryPath, model: effectiveModel, home: clonedEnv.HOME })

    let timedOut = false
    const startMs = Date.now()
    const proc = Bun.spawn(args, {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: clonedEnv,
    })

    proc.stdin.write(prompt)
    proc.stdin.end()

    const timer = setTimeout(async () => {
      timedOut = true
      proc.kill('SIGTERM')
      await Bun.sleep(2000)
      if (proc.exitCode === null) {
        proc.kill('SIGKILL')
      }
    }, effectiveTimeoutMs)

    let stdout: string
    let stderr: string
    try {
      ;[stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
    } finally {
      clearTimeout(timer)
    }

    const durationMs = Date.now() - startMs
    const failed = !timedOut && proc.exitCode !== null && proc.exitCode !== 0

    this.logger.info({
      event: 'claude_done',
      exitCode: proc.exitCode,
      durationMs,
      ...(failed && {
        stderr: stderr.slice(0, 1000) || undefined,
        stdout: stdout.slice(0, 500) || undefined,
      }),
    })

    if (timedOut) {
      throw new ClaudeTimeoutError(effectiveTimeoutMs)
    }

    // Always parse JSON — on failure, extract the human-readable error from result field
    let parsed: Record<string, unknown> | undefined
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>
    } catch {
      this.logger.info({ event: 'claude_parse_error', stdout: stdout.slice(0, 500) })
    }

    if (failed || parsed?.is_error) {
      const errorMessage =
        (typeof parsed?.result === 'string' ? parsed.result : null) ??
        (stderr.trim() || `Claude exited with code ${proc.exitCode}`)
      this.logger.info({ event: 'claude_error', exitCode: proc.exitCode, message: errorMessage })
      throw new ClaudeExitError(proc.exitCode ?? 1, errorMessage)
    }

    if (!parsed) {
      throw new Error(`ClaudeClient: malformed JSON output: ${stdout}`)
    }
    const result = parsed.result
    if (typeof result !== 'string') {
      throw new Error(`ClaudeClient: unexpected result type in: ${stdout}`)
    }
    return result
  }
}
