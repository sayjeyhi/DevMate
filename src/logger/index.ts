import { mkdirSync, appendFileSync } from "node:fs"
import { dirname } from "node:path"

export interface Logger {
  info(msg: string, meta?: object): void
  error(msg: string, meta?: object): void
  warn(msg: string, meta?: object): void
  debug(msg: string, meta?: object): void
}

const LEVEL_PRIORITY = { debug: 0, info: 1, warn: 2, error: 3 } as const

type Level = keyof typeof LEVEL_PRIORITY

const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
} as const

const LEVEL_COLOR: Record<Level, string> = {
  debug: ANSI.dim,
  info: "",
  warn: ANSI.yellow,
  error: ANSI.red,
}

export function createLogger(
  level: "info" | "debug" | "error",
  mode?: "tty" | "json",
  logFilePath?: string
): Logger {
  const useColor =
    process.env.NO_COLOR === undefined &&
    process.env.CLICOLOR !== "0" &&
    process.env.TERM !== "dumb" &&
    Boolean(process.stdout.isTTY)

  const effectiveMode = mode ?? (process.stdout.isTTY ? "tty" : "json")

  if (logFilePath) {
    try { mkdirSync(dirname(logFilePath), { recursive: true }) } catch {}
  }

  function emit(msgLevel: Level, msg: string, meta?: object): void {
    if (LEVEL_PRIORITY[msgLevel] < LEVEL_PRIORITY[level as Level]) return

    const jsonLine = JSON.stringify({ level: msgLevel, ts: new Date().toISOString(), msg, ...meta })

    if (logFilePath) {
      try { appendFileSync(logFilePath, jsonLine + "\n") } catch {}
    }

    if (effectiveMode === "json") {
      process.stdout.write(jsonLine + "\n")
    } else {
      const label = msgLevel.toUpperCase().padEnd(5)
      const colored =
        useColor && LEVEL_COLOR[msgLevel]
          ? `${LEVEL_COLOR[msgLevel]}[${label}]${ANSI.reset}`
          : `[${label}]`
      const metaPart = meta && Object.keys(meta).length > 0 ? `  ${JSON.stringify(meta)}` : ""
      process.stdout.write(`${colored} ${msg}${metaPart}\n`)
    }
  }

  return {
    info: (msg, meta) => emit("info", msg, meta),
    error: (msg, meta) => emit("error", msg, meta),
    warn: (msg, meta) => emit("warn", msg, meta),
    debug: (msg, meta) => emit("debug", msg, meta),
  }
}

export function appendToLogFile(
  logFilePath: string,
  level: Level,
  msg: string,
  meta?: object
): void {
  try {
    mkdirSync(dirname(logFilePath), { recursive: true })
    const line = JSON.stringify({ level, ts: new Date().toISOString(), msg, ...meta })
    appendFileSync(logFilePath, line + "\n")
  } catch {}
}
