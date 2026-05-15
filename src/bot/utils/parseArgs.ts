import type { Context } from "grammy"

/**
 * Extracts positional arguments from ctx.match.
 * Trims the match string, splits on whitespace, and filters empty strings.
 * Returns [] if match is empty or undefined.
 */
export function parseArgs(ctx: Context): string[] {
  const match = ctx.match
  // ctx.match can be string | RegExpMatchArray | undefined; only string is useful here
  if (!match || typeof match !== "string") return []
  return match
    .trim()
    .split(/\s+/)
    .filter(s => s !== "")
}

/**
 * Splits input into the first whitespace-delimited token and the raw remainder.
 * Uses regex /^(\S+)\s+([\s\S]*)$/ — preserves all whitespace within the remainder.
 * Returns null if input has only one token or is empty.
 */
export function parseFirstAndRest(input: string): { first: string; rest: string } | null {
  const match = /^(\S+)\s+([\s\S]*)$/.exec(input)
  if (!match) return null
  return { first: match[1], rest: match[2] }
}
