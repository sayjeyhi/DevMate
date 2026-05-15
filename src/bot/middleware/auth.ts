import type { Context, MiddlewareFn } from "grammy"

/**
 * Creates a grammY middleware that silently drops updates from users not in
 * the allowlist. Never replies to unauthorized users — silence is intentional
 * to avoid confirming the bot's existence.
 *
 * @param allowedIds - Set<number> of permitted Telegram user IDs. O(1) lookup.
 * @param logger - Injectable logger. Receives plain objects only; never receives
 *   userId (PII). Defaults to console.log.
 */
export function createAuthMiddleware(
  allowedIds: Set<number>,
  logger: (entry: Record<string, unknown>) => void = e => console.log(e),
): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id

    if (userId === undefined || !allowedIds.has(userId)) {
      // Log chatId only — never userId (PII)
      logger({ event: "unauthorized", chatId: ctx.chat?.id })
      return
    }

    return next()
  }
}
