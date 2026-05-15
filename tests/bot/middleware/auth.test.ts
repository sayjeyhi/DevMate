import { describe, it, expect, mock } from "bun:test"
import { createAuthMiddleware } from "../../../src/bot/middleware/auth"

function makeCtx(userId: number | undefined, chatId: number | undefined = 1) {
  return {
    from: userId !== undefined ? { id: userId } : undefined,
    chat: chatId !== undefined ? { id: chatId } : undefined,
    reply: mock().mockResolvedValue({}),
  }
}

describe("createAuthMiddleware", () => {
  const allowedIds = new Set([12345, 67890])

  it("authorized user — next() is called", async () => {
    const middleware = createAuthMiddleware(allowedIds)
    const ctx = makeCtx(12345, 99)
    const next = mock().mockResolvedValue(undefined)
    await middleware(ctx as never, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it("unauthorized user — next() is NOT called, no reply sent", async () => {
    const middleware = createAuthMiddleware(allowedIds)
    const ctx = makeCtx(99999, 99)
    const next = mock()
    await middleware(ctx as never, next)
    expect(next).not.toHaveBeenCalled()
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it("ctx.from is undefined — treated as unauthorized, no crash", async () => {
    const middleware = createAuthMiddleware(allowedIds)
    const ctx = makeCtx(undefined, 99)
    const next = mock()
    await expect(middleware(ctx as never, next)).resolves.toBeUndefined()
    expect(next).not.toHaveBeenCalled()
  })

  it("empty Set — all users unauthorized", async () => {
    const middleware = createAuthMiddleware(new Set<number>())
    const ctx = makeCtx(12345, 99)
    const next = mock()
    await middleware(ctx as never, next)
    expect(next).not.toHaveBeenCalled()
  })

  it("unauthorized attempt — logger receives { event, chatId } without userId", async () => {
    const logger = mock()
    const middleware = createAuthMiddleware(new Set([999]), logger)
    const ctx = makeCtx(12345, 42)
    await middleware(ctx as never, mock())
    expect(logger).toHaveBeenCalledTimes(1)
    const logged = logger.mock.calls[0][0] as Record<string, unknown>
    expect(logged.event).toBe("unauthorized")
    expect(logged.chatId).toBe(42)
    expect("userId" in logged).toBe(false)
  })

  it("authorized attempt — logger is never called", async () => {
    const logger = mock()
    const middleware = createAuthMiddleware(new Set([12345]), logger)
    const ctx = makeCtx(12345, 99)
    await middleware(ctx as never, mock().mockResolvedValue(undefined))
    expect(logger).not.toHaveBeenCalled()
  })

  it("ctx.chat is undefined — unauthorized drop does not crash", async () => {
    const logger = mock()
    const middleware = createAuthMiddleware(new Set([999]), logger)
    const ctx = { from: { id: 12345 }, chat: undefined, reply: mock() }
    const next = mock()
    await expect(middleware(ctx as never, next)).resolves.toBeUndefined()
    expect(next).not.toHaveBeenCalled()
    expect(logger.mock.calls[0][0].chatId).toBeUndefined()
  })
})
