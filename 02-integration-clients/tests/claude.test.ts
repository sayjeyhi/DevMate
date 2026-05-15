import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ClaudeClient } from '../src/claude/ClaudeClient'
import { ClaudeTimeoutError, ClaudeExitError } from '../src/errors'

const mockLogger = { info: vi.fn(), error: vi.fn() }

const baseConfig = {
  binaryPath: '/usr/local/bin/claude',
  timeoutMs: 5000,
}

function makeStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(new TextEncoder().encode(text))
      ctrl.close()
    },
  })
}

function makeMockProc(opts: { exitCode?: number; stdout?: string; stderr?: string } = {}) {
  const { exitCode = 0, stdout = '', stderr = '' } = opts
  return {
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: makeStream(stdout),
    stderr: makeStream(stderr),
    exitCode,
    exited: Promise.resolve(exitCode),
    kill: vi.fn(),
  }
}

function makeHungProc(opts: { stdout?: string; stderr?: string } = {}) {
  const { stdout = '', stderr = '' } = opts
  let resolveExited!: (code: number) => void
  const exited = new Promise<number>(resolve => {
    resolveExited = resolve
  })
  const proc = {
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: makeStream(stdout),
    stderr: makeStream(stderr),
    exitCode: null as number | null,
    exited,
    kill: vi.fn().mockImplementation((signal: string) => {
      if (signal === 'SIGKILL') {
        proc.exitCode = 137
        resolveExited(137)
      }
    }),
  }
  return proc
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.unstubAllGlobals() })

// ─── Subprocess invocation ────────────────────────────────────────────────────

describe('subprocess invocation', () => {
  it('writes prompt to stdin and closes it; prompt not in argv', async () => {
    const proc = makeMockProc({ stdout: '{"result":"ok"}' })
    const spawn = vi.fn().mockReturnValue(proc)
    vi.stubGlobal('Bun', { spawn, sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient(baseConfig, mockLogger)
    await client.ask('my secret prompt')

    expect(proc.stdin.write).toHaveBeenCalledWith('my secret prompt')
    expect(proc.stdin.end).toHaveBeenCalled()
    const [args] = spawn.mock.calls[0] as [string[]]
    expect(args.join(' ')).not.toContain('my secret prompt')
  })

  it('deletes CLAUDECODE from env (not set to undefined)', async () => {
    process.env.CLAUDECODE = '1'
    const proc = makeMockProc({ stdout: '{"result":"ok"}' })
    const spawn = vi.fn().mockReturnValue(proc)
    vi.stubGlobal('Bun', { spawn, sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient(baseConfig, mockLogger)
    await client.ask('prompt')

    const [, spawnOpts] = spawn.mock.calls[0] as [string[], { env: Record<string, unknown> }]
    expect('CLAUDECODE' in spawnOpts.env).toBe(false)
    delete process.env.CLAUDECODE
  })

  it('includes required fixed flags in args', async () => {
    const proc = makeMockProc({ stdout: '{"result":"ok"}' })
    const spawn = vi.fn().mockReturnValue(proc)
    vi.stubGlobal('Bun', { spawn, sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient(baseConfig, mockLogger)
    await client.ask('prompt')

    const [args] = spawn.mock.calls[0] as [string[]]
    expect(args).toContain('--print')
    expect(args).toContain('--bare')
    expect(args).toContain('--no-session-persistence')
    expect(args).toContain('--output-format')
    expect(args).toContain('json')
  })

  it('omits --model when no model configured', async () => {
    const proc = makeMockProc({ stdout: '{"result":"ok"}' })
    const spawn = vi.fn().mockReturnValue(proc)
    vi.stubGlobal('Bun', { spawn, sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient(baseConfig, mockLogger)
    await client.ask('prompt')

    const [args] = spawn.mock.calls[0] as [string[]]
    expect(args).not.toContain('--model')
  })

  it('includes --model from ClaudeConfig.model', async () => {
    const proc = makeMockProc({ stdout: '{"result":"ok"}' })
    const spawn = vi.fn().mockReturnValue(proc)
    vi.stubGlobal('Bun', { spawn, sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient({ ...baseConfig, model: 'claude-3-opus' }, mockLogger)
    await client.ask('prompt')

    const [args] = spawn.mock.calls[0] as [string[]]
    expect(args).toContain('--model')
    expect(args).toContain('claude-3-opus')
  })

  it('includes --model from AskOptions.model (overrides config)', async () => {
    const proc = makeMockProc({ stdout: '{"result":"ok"}' })
    const spawn = vi.fn().mockReturnValue(proc)
    vi.stubGlobal('Bun', { spawn, sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient({ ...baseConfig, model: 'claude-3-opus' }, mockLogger)
    await client.ask('prompt', { model: 'claude-3-sonnet' })

    const [args] = spawn.mock.calls[0] as [string[]]
    expect(args).toContain('--model')
    expect(args).toContain('claude-3-sonnet')
    expect(args).not.toContain('claude-3-opus')
  })
})

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('happy path', () => {
  it('returns result string from JSON stdout', async () => {
    const proc = makeMockProc({ exitCode: 0, stdout: '{"result":"some response"}' })
    vi.stubGlobal('Bun', { spawn: vi.fn().mockReturnValue(proc), sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient(baseConfig, mockLogger)
    const result = await client.ask('test prompt')
    expect(result).toBe('some response')
  })

  it('returns only the result field, not the whole parsed object', async () => {
    const proc = makeMockProc({ exitCode: 0, stdout: '{"result":"hello","extra":"ignored"}' })
    vi.stubGlobal('Bun', { spawn: vi.fn().mockReturnValue(proc), sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient(baseConfig, mockLogger)
    const result = await client.ask('prompt')
    expect(result).toBe('hello')
    expect(typeof result).toBe('string')
  })
})

// ─── Error paths ──────────────────────────────────────────────────────────────

describe('error paths', () => {
  it('non-zero exit → throws ClaudeExitError with exitCode and stderr', async () => {
    const proc = makeMockProc({ exitCode: 1, stderr: 'command failed' })
    vi.stubGlobal('Bun', { spawn: vi.fn().mockReturnValue(proc), sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient(baseConfig, mockLogger)
    const err = await client.ask('prompt').catch(e => e)

    expect(err).toBeInstanceOf(ClaudeExitError)
    expect((err as ClaudeExitError).exitCode).toBe(1)
    expect((err as ClaudeExitError).stderr).toBe('command failed')
  })

  it('exit 0 but invalid JSON stdout → throws Error containing raw stdout', async () => {
    const proc = makeMockProc({ exitCode: 0, stdout: 'not valid json' })
    vi.stubGlobal('Bun', { spawn: vi.fn().mockReturnValue(proc), sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient(baseConfig, mockLogger)
    const err = await client.ask('prompt').catch(e => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('not valid json')
  })

  it('exit 0 but result is not a string → throws Error', async () => {
    const proc = makeMockProc({ exitCode: 0, stdout: '{"result":null}' })
    vi.stubGlobal('Bun', { spawn: vi.fn().mockReturnValue(proc), sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient(baseConfig, mockLogger)
    const err = await client.ask('prompt').catch(e => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('unexpected result type')
  })
})

// ─── Timeout behavior ─────────────────────────────────────────────────────────

describe('timeout behavior', () => {
  it('sends SIGTERM then SIGKILL and throws ClaudeTimeoutError', async () => {
    const proc = makeHungProc()
    vi.stubGlobal('Bun', {
      spawn: vi.fn().mockReturnValue(proc),
      sleep: vi.fn().mockResolvedValue(undefined),
    })

    const client = new ClaudeClient({ ...baseConfig, timeoutMs: 1 }, mockLogger)
    const err = await client.ask('prompt').catch(e => e)

    expect(err).toBeInstanceOf(ClaudeTimeoutError)
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('ClaudeTimeoutError carries the timeoutMs value', async () => {
    const proc = makeHungProc()
    vi.stubGlobal('Bun', {
      spawn: vi.fn().mockReturnValue(proc),
      sleep: vi.fn().mockResolvedValue(undefined),
    })

    const client = new ClaudeClient({ ...baseConfig, timeoutMs: 1 }, mockLogger)
    const err = await client.ask('prompt').catch(e => e)

    expect(err).toBeInstanceOf(ClaudeTimeoutError)
    expect((err as ClaudeTimeoutError).timeoutMs).toBe(1)
  })

  it('AskOptions.timeoutMs overrides config timeout', async () => {
    const proc = makeHungProc()
    vi.stubGlobal('Bun', {
      spawn: vi.fn().mockReturnValue(proc),
      sleep: vi.fn().mockResolvedValue(undefined),
    })

    const client = new ClaudeClient({ ...baseConfig, timeoutMs: 60000 }, mockLogger)
    const err = await client.ask('prompt', { timeoutMs: 1 }).catch(e => e)

    expect(err).toBeInstanceOf(ClaudeTimeoutError)
    expect((err as ClaudeTimeoutError).timeoutMs).toBe(1)
  })

  it('throws ClaudeTimeoutError (not ClaudeExitError) when kill causes non-zero exit', async () => {
    // timedOut flag must be checked before exit code
    const proc = makeHungProc()
    vi.stubGlobal('Bun', {
      spawn: vi.fn().mockReturnValue(proc),
      sleep: vi.fn().mockResolvedValue(undefined),
    })

    const client = new ClaudeClient({ ...baseConfig, timeoutMs: 1 }, mockLogger)
    const err = await client.ask('prompt').catch(e => e)

    expect(err).toBeInstanceOf(ClaudeTimeoutError)
    expect(err).not.toBeInstanceOf(ClaudeExitError)
  })

  it('does not send SIGKILL if process exits during grace period', async () => {
    // SIGTERM kills the process before SIGKILL check
    let resolveExited!: (code: number) => void
    const exited = new Promise<number>(resolve => { resolveExited = resolve })
    const proc = {
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: makeStream(''),
      stderr: makeStream(''),
      exitCode: null as number | null,
      exited,
      kill: vi.fn().mockImplementation((signal: string) => {
        if (signal === 'SIGTERM') {
          proc.exitCode = 15
          resolveExited(15)
        }
      }),
    }

    vi.stubGlobal('Bun', {
      spawn: vi.fn().mockReturnValue(proc),
      sleep: vi.fn().mockResolvedValue(undefined),
    })

    const client = new ClaudeClient({ ...baseConfig, timeoutMs: 1 }, mockLogger)
    await client.ask('prompt').catch(() => {})

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
    expect(proc.kill).not.toHaveBeenCalledWith('SIGKILL')
  })

  it('clears timer on successful call (no timer leak)', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const proc = makeMockProc({ stdout: '{"result":"done"}' })
    vi.stubGlobal('Bun', { spawn: vi.fn().mockReturnValue(proc), sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient(baseConfig, mockLogger)
    await client.ask('prompt')

    expect(clearTimeoutSpy).toHaveBeenCalled()
  })
})

// ─── Concurrent stdout/stderr drain ──────────────────────────────────────────

describe('stdout drain', () => {
  it('reads stdout and stderr concurrently via Promise.all (no deadlock)', async () => {
    // Both streams must be drained; if sequential, a full pipe would deadlock.
    // With mocked streams this just verifies both are read.
    const proc = makeMockProc({ exitCode: 0, stdout: '{"result":"data"}', stderr: 'some warning' })
    const spawn = vi.fn().mockReturnValue(proc)
    vi.stubGlobal('Bun', { spawn, sleep: vi.fn().mockResolvedValue(undefined) })

    const client = new ClaudeClient(baseConfig, mockLogger)
    const result = await client.ask('prompt')
    expect(result).toBe('data')
  })
})
