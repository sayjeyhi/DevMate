import type { Context } from "grammy"
import type { Clients } from "./index"
import { keepTyping } from "../utils/typing"
import { JiraAuthError } from "../../shared/errors"
import type { JiraIssue } from "../../jira/types"

export const PAGE_SIZE = 5

// tokens[pageN] = nextPageToken needed to fetch page N (undefined = first page, no token needed)
// hasNext[pageN] = whether a nextPageToken was returned when fetching page N
const pageCache = new Map<number, { tokens: Map<number, string | undefined>; hasNext: Map<number, boolean> }>()

interface CallbackButton {
  text: string
  callback_data: string
}

interface InlineKeyboardMarkup {
  inline_keyboard: CallbackButton[][]
}

const STATUS_EMOJI: Record<string, string> = {
  "to do": "⬜",
  "open": "⬜",
  "backlog": "⬜",
  "in progress": "🔵",
  "in review": "🟣",
  "blocked": "🔴",
  "done": "✅",
  "closed": "✅",
  "resolved": "✅",
  "cancelled": "⛔",
}

export function statusEmoji(status: string): string {
  return STATUS_EMOJI[status.toLowerCase()] ?? "⚪"
}

export function formatTicketsPage(issues: JiraIssue[], page: number, hasNext: boolean): string {
  const from = page * PAGE_SIZE + 1
  const to = from + issues.length - 1
  const range = hasNext ? `${from}–${to}+` : `${from}–${to}`

  const lines = issues.map((issue, i) => {
    const num = from + i
    const emoji = statusEmoji(issue.status)
    return `${num}. [${issue.key}] ${issue.summary}\n   ${emoji} ${issue.status} — ${issue.url}`
  })

  return `📋 Your tickets (${range}):\n\n${lines.join("\n\n")}`
}

export function buildPaginationKeyboard(page: number, hasPrev: boolean, hasNext: boolean): InlineKeyboardMarkup | undefined {
  if (!hasPrev && !hasNext) return undefined

  const buttons: CallbackButton[] = []
  if (hasPrev) buttons.push({ text: "← Prev", callback_data: `myt:p:${page - 1}` })
  if (hasNext) buttons.push({ text: "Next →", callback_data: `myt:p:${page + 1}` })
  return { inline_keyboard: [buttons] }
}

export async function handleMyTickets(ctx: Context, { jira }: Clients): Promise<void> {
  const stopTyping = keepTyping(ctx)
  try {
    const { issues, nextPageToken } = await jira.getMyIssues(PAGE_SIZE).finally(stopTyping)

    if (issues.length === 0) {
      await ctx.reply("No tickets assigned to you.")
      return
    }

    const chatId = ctx.chat!.id
    const tokens = new Map<number, string | undefined>([[0, undefined]])
    const hasNext = new Map<number, boolean>([[0, !!nextPageToken]])
    if (nextPageToken) tokens.set(1, nextPageToken)
    pageCache.set(chatId, { tokens, hasNext })

    const text = formatTicketsPage(issues, 0, !!nextPageToken)
    const keyboard = buildPaginationKeyboard(0, false, !!nextPageToken)

    await ctx.reply(text, { reply_markup: keyboard })
  } catch (err) {
    stopTyping()
    if (err instanceof JiraAuthError) {
      await ctx.reply("Authentication failed. Please check your Jira API token.")
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    console.log({ event: "error", command: "my_tickets", errorMessage: message })
    await ctx.reply("Something went wrong. Please try again.")
  }
}

export async function handleMyTicketsPage(ctx: Context, { jira }: Clients, page: number): Promise<void> {
  try {
    const chatId = ctx.chat!.id
    const cache = pageCache.get(chatId)
    const token = cache?.tokens.get(page)

    const { issues, nextPageToken } = await jira.getMyIssues(PAGE_SIZE, token)

    if (cache) {
      cache.hasNext.set(page, !!nextPageToken)
      if (nextPageToken) cache.tokens.set(page + 1, nextPageToken)
    }

    const hasNext = !!nextPageToken
    const hasPrev = page > 0
    const text = formatTicketsPage(issues, page, hasNext)
    const keyboard = buildPaginationKeyboard(page, hasPrev, hasNext)

    await ctx.editMessageText(text, { reply_markup: keyboard })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.log({ event: "error", command: "my_tickets_page", errorMessage: message })
  } finally {
    await ctx.answerCallbackQuery()
  }
}
