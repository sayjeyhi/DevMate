import { describe, it, expect, mock } from "bun:test"
import {
  handleMyTickets,
  handleMyTicketsPage,
  statusEmoji,
  formatTicketsPage,
  buildPaginationKeyboard,
  PAGE_SIZE,
} from "../../../src/bot/commands/my-tickets"
import { JiraAuthError } from "../../../src/shared/errors"
import type { JiraIssue } from "../../../src/jira/types"

function makeIssue(n: number, status = "In Progress"): JiraIssue {
  return {
    key: `ENG-${n}`,
    summary: `Issue ${n}`,
    status,
    description: "",
    url: `https://jira.example.com/browse/ENG-${n}`,
  }
}

function makeCtx(chatId = 42) {
  return {
    chat: { id: chatId },
    reply: mock().mockResolvedValue({}),
    replyWithChatAction: mock().mockResolvedValue({}),
    editMessageText: mock().mockResolvedValue({}),
    answerCallbackQuery: mock().mockResolvedValue({}),
  }
}

function makeClients(result: unknown = { issues: [], nextPageToken: undefined }) {
  return {
    jira: {
      getMyIssues:
        result instanceof Error
          ? mock().mockRejectedValue(result)
          : mock().mockResolvedValue(result),
    },
  }
}

describe("statusEmoji", () => {
  it("returns ✅ for Done", () => { expect(statusEmoji("Done")).toBe("✅") })
  it("returns ✅ for Closed", () => { expect(statusEmoji("Closed")).toBe("✅") })
  it("returns ✅ for Resolved", () => { expect(statusEmoji("Resolved")).toBe("✅") })
  it("returns 🔵 for In Progress", () => { expect(statusEmoji("In Progress")).toBe("🔵") })
  it("returns 🟣 for In Review", () => { expect(statusEmoji("In Review")).toBe("🟣") })
  it("returns ⬜ for To Do", () => { expect(statusEmoji("To Do")).toBe("⬜") })
  it("returns ⬜ for Backlog", () => { expect(statusEmoji("Backlog")).toBe("⬜") })
  it("returns 🔴 for Blocked", () => { expect(statusEmoji("Blocked")).toBe("🔴") })
  it("returns ⛔ for Cancelled", () => { expect(statusEmoji("Cancelled")).toBe("⛔") })
  it("returns ⚪ for unknown status", () => { expect(statusEmoji("Weird Status")).toBe("⚪") })
  it("is case-insensitive", () => { expect(statusEmoji("IN PROGRESS")).toBe("🔵") })
})

describe("formatTicketsPage", () => {
  it("shows range without total when no next page", () => {
    const issues = [makeIssue(1)]
    const text = formatTicketsPage(issues, 0, false)
    expect(text).toContain("1–1")
    expect(text).not.toContain("of ")
  })

  it("appends + to range when more pages exist", () => {
    const issues = Array.from({ length: PAGE_SIZE }, (_, i) => makeIssue(i + 1))
    const text = formatTicketsPage(issues, 0, true)
    expect(text).toContain(`1–${PAGE_SIZE}+`)
  })

  it("calculates range from offset on page 2", () => {
    const issues = [makeIssue(6), makeIssue(7)]
    const text = formatTicketsPage(issues, 1, false)
    expect(text).toContain("6–7")
  })

  it("numbers items from correct offset", () => {
    const issues = [makeIssue(6), makeIssue(7)]
    const text = formatTicketsPage(issues, 1, false)
    expect(text).toContain("6. [ENG-6]")
    expect(text).toContain("7. [ENG-7]")
  })

  it("shows emoji for each ticket status", () => {
    const issues = [makeIssue(1, "Done"), makeIssue(2, "In Progress")]
    const text = formatTicketsPage(issues, 0, false)
    expect(text).toContain("✅")
    expect(text).toContain("🔵")
  })

  it("includes status text", () => {
    const issues = [makeIssue(1, "In Progress")]
    const text = formatTicketsPage(issues, 0, false)
    expect(text).toContain("In Progress")
  })

  it("includes the Jira URL", () => {
    const issues = [makeIssue(1)]
    const text = formatTicketsPage(issues, 0, false)
    expect(text).toContain("https://jira.example.com/browse/ENG-1")
  })

  it("includes the issue key and summary", () => {
    const issues = [makeIssue(42)]
    const text = formatTicketsPage(issues, 0, false)
    expect(text).toContain("ENG-42")
    expect(text).toContain("Issue 42")
  })

  it("separates tickets with blank lines", () => {
    const issues = [makeIssue(1), makeIssue(2)]
    const text = formatTicketsPage(issues, 0, false)
    expect(text).toContain("\n\n")
  })
})

describe("buildPaginationKeyboard", () => {
  it("returns undefined when no prev and no next", () => {
    expect(buildPaginationKeyboard(0, false, false)).toBeUndefined()
  })

  it("returns keyboard when hasNext is true", () => {
    expect(buildPaginationKeyboard(0, false, true)).toBeDefined()
  })

  it("returns keyboard when hasPrev is true", () => {
    expect(buildPaginationKeyboard(1, true, false)).toBeDefined()
  })

  it("first page: Next only, no Prev", () => {
    const kb = buildPaginationKeyboard(0, false, true)!
    const buttons = kb.inline_keyboard.flat() as { text: string; callback_data: string }[]
    expect(buttons.some(b => b.text.includes("Next"))).toBe(true)
    expect(buttons.some(b => b.text.includes("Prev"))).toBe(false)
  })

  it("last page: Prev only, no Next", () => {
    const kb = buildPaginationKeyboard(2, true, false)!
    const buttons = kb.inline_keyboard.flat() as { text: string; callback_data: string }[]
    expect(buttons.some(b => b.text.includes("Prev"))).toBe(true)
    expect(buttons.some(b => b.text.includes("Next"))).toBe(false)
  })

  it("middle page: both Prev and Next", () => {
    const kb = buildPaginationKeyboard(1, true, true)!
    const buttons = kb.inline_keyboard.flat() as { text: string; callback_data: string }[]
    expect(buttons.some(b => b.text.includes("Prev"))).toBe(true)
    expect(buttons.some(b => b.text.includes("Next"))).toBe(true)
  })

  it("Prev callback data points to previous page", () => {
    const kb = buildPaginationKeyboard(2, true, true)!
    const prev = (kb.inline_keyboard.flat() as { text: string; callback_data: string }[]).find(b => b.text.includes("Prev"))!
    expect(prev.callback_data).toBe("myt:p:1")
  })

  it("Next callback data points to next page", () => {
    const kb = buildPaginationKeyboard(1, true, true)!
    const next = (kb.inline_keyboard.flat() as { text: string; callback_data: string }[]).find(b => b.text.includes("Next"))!
    expect(next.callback_data).toBe("myt:p:2")
  })
})

describe("handleMyTickets", () => {
  it("replies with no-tickets message when Jira returns empty list", async () => {
    const ctx = makeCtx()
    const clients = makeClients({ issues: [], nextPageToken: undefined })

    await handleMyTickets(ctx as never, clients as never)

    const reply = ctx.reply.mock.calls[0][0] as string
    expect(reply.toLowerCase()).toContain("no ticket")
  })

  it("calls getMyIssues with PAGE_SIZE and no token", async () => {
    const ctx = makeCtx()
    const clients = makeClients({ issues: [makeIssue(1)], nextPageToken: undefined })

    await handleMyTickets(ctx as never, clients as never)

    expect(clients.jira.getMyIssues).toHaveBeenCalledWith(PAGE_SIZE)
  })

  it("sends reply containing ticket key and summary", async () => {
    const ctx = makeCtx()
    const clients = makeClients({ issues: [makeIssue(1)], nextPageToken: undefined })

    await handleMyTickets(ctx as never, clients as never)

    const reply = ctx.reply.mock.calls[0][0] as string
    expect(reply).toContain("ENG-1")
    expect(reply).toContain("Issue 1")
  })

  it("attaches pagination keyboard when nextPageToken present", async () => {
    const ctx = makeCtx()
    const issues = Array.from({ length: PAGE_SIZE }, (_, i) => makeIssue(i + 1))
    const clients = makeClients({ issues, nextPageToken: "cursor-abc" })

    await handleMyTickets(ctx as never, clients as never)

    const opts = ctx.reply.mock.calls[0][1] as { reply_markup?: unknown }
    expect(opts?.reply_markup).toBeDefined()
  })

  it("sends no keyboard when no nextPageToken", async () => {
    const ctx = makeCtx()
    const clients = makeClients({ issues: [makeIssue(1)], nextPageToken: undefined })

    await handleMyTickets(ctx as never, clients as never)

    const opts = ctx.reply.mock.calls[0][1] as { reply_markup?: unknown }
    expect(opts?.reply_markup).toBeUndefined()
  })

  it("JiraAuthError → replies with auth/token error message", async () => {
    const ctx = makeCtx()
    const clients = makeClients(new JiraAuthError())

    await handleMyTickets(ctx as never, clients as never)

    const reply = (ctx.reply.mock.calls[0][0] as string).toLowerCase()
    expect(reply).toMatch(/auth|token/)
  })

  it("generic error → replies with something went wrong message", async () => {
    const ctx = makeCtx()
    const clients = makeClients(new Error("Network failure"))

    await handleMyTickets(ctx as never, clients as never)

    const reply = (ctx.reply.mock.calls[0][0] as string).toLowerCase()
    expect(reply).toContain("something went wrong")
  })
})

describe("handleMyTicketsPage", () => {
  it("calls getMyIssues with PAGE_SIZE", async () => {
    const ctx = makeCtx()
    const issues = [makeIssue(6)]
    const clients = makeClients({ issues, nextPageToken: undefined })

    await handleMyTicketsPage(ctx as never, clients as never, 1)

    expect(clients.jira.getMyIssues).toHaveBeenCalledWith(PAGE_SIZE, undefined)
  })

  it("uses cached token when available", async () => {
    const chatId = 99
    const ctx = makeCtx(chatId)
    const setupClients = makeClients({ issues: Array.from({ length: PAGE_SIZE }, (_, i) => makeIssue(i + 1)), nextPageToken: "tok-page1" })
    await handleMyTickets(ctx as never, setupClients as never)

    const pageClients = makeClients({ issues: [makeIssue(6)], nextPageToken: undefined })
    await handleMyTicketsPage(ctx as never, pageClients as never, 1)

    expect(pageClients.jira.getMyIssues).toHaveBeenCalledWith(PAGE_SIZE, "tok-page1")
  })

  it("calls editMessageText with formatted ticket list", async () => {
    const ctx = makeCtx()
    const issues = [makeIssue(6)]
    const clients = makeClients({ issues, nextPageToken: undefined })

    await handleMyTicketsPage(ctx as never, clients as never, 1)

    expect(ctx.editMessageText).toHaveBeenCalled()
    const text = ctx.editMessageText.mock.calls[0][0] as string
    expect(text).toContain("ENG-6")
  })

  it("always calls answerCallbackQuery on success", async () => {
    const ctx = makeCtx()
    const clients = makeClients({ issues: [makeIssue(1)], nextPageToken: undefined })

    await handleMyTicketsPage(ctx as never, clients as never, 0)

    expect(ctx.answerCallbackQuery).toHaveBeenCalled()
  })

  it("still calls answerCallbackQuery on error", async () => {
    const ctx = makeCtx()
    const clients = makeClients(new Error("Network failure"))

    await handleMyTicketsPage(ctx as never, clients as never, 1)

    expect(ctx.answerCallbackQuery).toHaveBeenCalled()
  })

  it("shows Next button when nextPageToken present", async () => {
    const ctx = makeCtx()
    const issues = Array.from({ length: PAGE_SIZE }, (_, i) => makeIssue(i + 6))
    const clients = makeClients({ issues, nextPageToken: "cursor-next" })

    await handleMyTicketsPage(ctx as never, clients as never, 1)

    const opts = ctx.editMessageText.mock.calls[0][1] as { reply_markup?: unknown }
    expect(opts?.reply_markup).toBeDefined()
  })
})
