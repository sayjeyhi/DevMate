import { describe, it, expect, mock } from "bun:test"
import { handleSolve, SOLVE_PROMPT_TEMPLATE } from "../../../src/bot/commands/solve"
import { JiraAuthError, JiraNotFoundError, ClaudeTimeoutError, ClaudeExitError } from "../../../src/shared/errors"

function makeCtx(match: string) {
  return {
    match,
    chat: { id: 42 },
    reply: mock().mockResolvedValue({ message_id: 1 }),
    replyWithChatAction: mock().mockResolvedValue({}),
    api: {
      editMessageText: mock().mockResolvedValue({}),
    },
  }
}

const MOCK_ISSUE = {
  key: "ENG-1",
  summary: "Fix login bug",
  status: "In Progress",
  description: "Users cannot log in.",
  url: "https://test.atlassian.net/browse/ENG-1",
}

type MockClients = {
  jira: { getIssue: ReturnType<typeof mock> }
  claude: { ask: ReturnType<typeof mock> }
}

function makeClients(
  getIssueImpl: unknown = MOCK_ISSUE,
  askImpl: unknown = "Here is the solution.",
): MockClients {
  return {
    jira: {
      getIssue:
        getIssueImpl instanceof Error
          ? mock().mockRejectedValue(getIssueImpl)
          : mock().mockResolvedValue(getIssueImpl),
    },
    claude: {
      ask:
        askImpl instanceof Error
          ? mock().mockRejectedValue(askImpl)
          : mock().mockResolvedValue(askImpl),
    },
  }
}

describe("SOLVE_PROMPT_TEMPLATE", () => {
  it("contains <key> XML delimiter", () => {
    expect(SOLVE_PROMPT_TEMPLATE).toContain("<key>")
  })

  it("contains <title> XML delimiter", () => {
    expect(SOLVE_PROMPT_TEMPLATE).toContain("<title>")
  })

  it("contains <status> XML delimiter", () => {
    expect(SOLVE_PROMPT_TEMPLATE).toContain("<status>")
  })

  it("contains <description> XML delimiter", () => {
    expect(SOLVE_PROMPT_TEMPLATE).toContain("<description>")
  })
})

describe("handleSolve", () => {
  it("no args → usage reply, no API calls", async () => {
    const ctx = makeCtx("")
    const clients = makeClients()

    await handleSolve(ctx as never, clients as never)

    expect(clients.jira.getIssue).not.toHaveBeenCalled()
    expect(clients.claude.ask).not.toHaveBeenCalled()
    const reply = ctx.reply.mock.calls[0][0] as string
    expect(reply.toLowerCase()).toMatch(/usage|\/solve/)
  })

  it("sends intermediate 'Analyzing…' reply before calling getIssue", async () => {
    const ctx = makeCtx("ENG-1")
    const clients = makeClients()

    await handleSolve(ctx as never, clients as never)

    const firstReply = ctx.reply.mock.calls[0][0] as string
    expect(firstReply.toLowerCase()).toContain("analyzing")
    expect(firstReply).toContain("ENG-1")
    expect(clients.jira.getIssue).toHaveBeenCalledWith("ENG-1")
  })

  it("calls ClaudeClient.ask after fetching issue, final reply contains response", async () => {
    const ctx = makeCtx("ENG-1")
    const clients = makeClients()

    await handleSolve(ctx as never, clients as never)

    expect(clients.claude.ask).toHaveBeenCalledTimes(1)
    const replies = ctx.reply.mock.calls.map(c => c[0] as string)
    expect(replies.some(r => r.includes("Here is the solution."))).toBe(true)
  })

  it("sends single content reply (no [N/M] prefix) for short Claude response", async () => {
    const ctx = makeCtx("ENG-1")
    const clients = makeClients(MOCK_ISSUE, "Short response.")

    await handleSolve(ctx as never, clients as never)

    expect(ctx.reply.mock.calls.length).toBe(2) // intermediate + content
    const contentReply = ctx.reply.mock.calls[1][0] as string
    expect(contentReply).not.toMatch(/^\[\d+\/\d+\]/)
  })

  it("sends multiple [N/M]-prefixed replies for long Claude response (>4096 chars)", async () => {
    const ctx = makeCtx("ENG-1")
    const longResponse = "word ".repeat(5000) // ~25,000 chars
    const clients = makeClients(MOCK_ISSUE, longResponse)

    await handleSolve(ctx as never, clients as never)

    expect(ctx.reply.mock.calls.length).toBeGreaterThan(2)
    const contentReplies = ctx.reply.mock.calls.slice(1).map(c => c[0] as string)
    for (const r of contentReplies) {
      expect(r).toMatch(/^\[\d+\/\d+\]/)
    }
  })

  it("JiraNotFoundError → reply contains key, Claude not called", async () => {
    const ctx = makeCtx("ENG-999")
    const clients = makeClients(new JiraNotFoundError("ENG-999"))

    await handleSolve(ctx as never, clients as never)

    expect(clients.claude.ask).not.toHaveBeenCalled()
    const replies = ctx.reply.mock.calls.map(c => c[0] as string)
    expect(replies.some(r => r.includes("ENG-999"))).toBe(true)
  })

  it("JiraAuthError → reply contains auth/token mention", async () => {
    const ctx = makeCtx("ENG-1")
    const clients = makeClients(new JiraAuthError())

    await handleSolve(ctx as never, clients as never)

    const replies = ctx.reply.mock.calls.map(c => c[0] as string)
    expect(replies.some(r => r.toLowerCase().match(/auth|token/))).toBe(true)
  })

  it("ClaudeTimeoutError → reply contains 'timed out'", async () => {
    const ctx = makeCtx("ENG-1")
    const clients = makeClients(MOCK_ISSUE, new ClaudeTimeoutError(30000))

    await handleSolve(ctx as never, clients as never)

    const replies = ctx.reply.mock.calls.map(c => c[0] as string)
    expect(replies.some(r => r.toLowerCase().includes("timed out"))).toBe(true)
  })

  it("ClaudeExitError → reply contains 'error'", async () => {
    const ctx = makeCtx("ENG-1")
    const clients = makeClients(MOCK_ISSUE, new ClaudeExitError(1, "stderr"))

    await handleSolve(ctx as never, clients as never)

    const replies = ctx.reply.mock.calls.map(c => c[0] as string)
    expect(replies.some(r => r.toLowerCase().includes("error"))).toBe(true)
  })

  it("sends typing action before API call", async () => {
    const ctx = makeCtx("ENG-1")
    const clients = makeClients()

    await handleSolve(ctx as never, clients as never)

    expect(ctx.replyWithChatAction).toHaveBeenCalledWith("typing")
  })

  it("generic error → 'something went wrong' reply", async () => {
    const ctx = makeCtx("ENG-1")
    const clients = makeClients(MOCK_ISSUE, new Error("Unexpected network failure"))

    await handleSolve(ctx as never, clients as never)

    const replies = ctx.reply.mock.calls.map(c => c[0] as string)
    expect(replies.some(r => r.toLowerCase().includes("something went wrong"))).toBe(true)
  })

  it("handles Jira description of 10,000+ chars without crashing", async () => {
    const ctx = makeCtx("ENG-1")
    const bigIssue = { ...MOCK_ISSUE, description: "x".repeat(12000) }
    const clients = makeClients(bigIssue)

    await handleSolve(ctx as never, clients as never)

    expect(clients.claude.ask).toHaveBeenCalledTimes(1)
    const prompt = clients.claude.ask.mock.calls[0][0] as string
    expect(prompt.length).toBeGreaterThan(10000)
  })
})
