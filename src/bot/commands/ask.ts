import type { Context } from "grammy"
import type { Clients } from "./index"
import { ClaudeTimeoutError, ClaudeExitError } from "../../shared/errors"
import { escapeHtml } from "./my-tickets"
import { splitMessage } from "../utils/splitMessage"
import type { GitClient } from "../../git/GitClient"

interface RepoEntry {
  projKey: string
  git: GitClient
}

interface PendingAsk {
  repoPath?: string
  inlineQuestion?: string
}

export const pendingAsk = new Map<number, PendingAsk>()

function flatRepos(gitMap: Map<string, GitClient[]>): RepoEntry[] {
  const result: RepoEntry[] = []
  for (const [projKey, gits] of gitMap) {
    for (const git of gits) result.push({ projKey, git })
  }
  return result
}

function repoLabel(entry: RepoEntry): string {
  const name = entry.git.repoPath.split("/").at(-1) ?? entry.git.repoPath
  return `📁 ${name} (${entry.projKey})`
}

async function gitStatusLines(git: GitClient): Promise<string> {
  try {
    const [branch, clean] = await Promise.all([git.currentBranch(), git.isClean()])
    const status = clean ? "✅ clean" : "⚠️ uncommitted changes"
    return `\n\nBranch: <code>${escapeHtml(branch)}</code>\nStatus: ${status}`
  } catch {
    return ""
  }
}

async function showRepoPicker(ctx: Context, repos: RepoEntry[]): Promise<void> {
  const rows = repos.map((r, i) => [{ text: repoLabel(r), callback_data: `ask:repo:${i}` }])
  await ctx.reply("📂 Select a repo to ask about:", {
    reply_markup: { inline_keyboard: rows },
  })
  if (ctx.callbackQuery) await ctx.answerCallbackQuery()
}

export async function askQuestion(
  ctx: Context,
  clients: Clients,
  question: string,
  repoPath?: string,
): Promise<void> {
  const label = repoPath
    ? `<code>${escapeHtml(repoPath.split("/").at(-1) ?? repoPath)}</code>`
    : "no repo context"
  const progressMsg = await ctx.reply(`🤔 Asking Claude (${label})…`, { parse_mode: "HTML" })
  const chatId = ctx.chat!.id
  const msgId = progressMsg.message_id

  const edit = async (text: string) => {
    try { await ctx.api.editMessageText(chatId, msgId, text, { parse_mode: "HTML" }) } catch {}
  }

  const HEADER = `🤔 Asking Claude (${label})…\n\n`
  const MAX_CONTENT = 4096 - HEADER.length - 13 // 13 = len("<pre></pre>")

  function buildProgressMsg(lines: string[]): string {
    const raw = lines.map(escapeHtml).join("\n")
    // Keep tail so the most recent output is always visible
    const content = raw.length > MAX_CONTENT
      ? "…\n" + raw.slice(raw.length - (MAX_CONTENT - 2))
      : raw
    return `${HEADER}<pre>${content}</pre>`
  }

  try {
    await ctx.replyWithChatAction("typing")
    const response = await clients.claude.ask(question, {
      cwd: repoPath,
      onProgress: async (lines: string[]) => {
        await edit(buildProgressMsg(lines))
      },
    })
    await edit(`✅ Done (${label})`)
    for (const chunk of splitMessage(response)) {
      await ctx.reply(chunk)
    }
  } catch (err) {
    if (err instanceof ClaudeTimeoutError) { await ctx.reply("Claude timed out. Please try again."); return }
    if (err instanceof ClaudeExitError) {
      const isAuth = /not logged in|please run \/login/i.test(err.stderr)
      await ctx.reply(isAuth
        ? "Claude is not authenticated. Run `claude login` then restart the bot."
        : "Claude returned an error. Please try again.")
      return
    }
    await ctx.reply("Something went wrong. Please try again.")
  }
}

export async function handleAsk(ctx: Context, clients: Clients): Promise<void> {
  const question = typeof ctx.match === "string" ? ctx.match.trim() : ""
  const repos = clients.gitMap ? flatRepos(clients.gitMap) : []

  if (repos.length === 0) {
    if (question) {
      await askQuestion(ctx, clients, question)
    } else {
      pendingAsk.set(ctx.chat!.id, {})
      await ctx.reply("No repos configured. Type your question and I'll ask Claude without repo context:")
    }
    return
  }

  if (repos.length === 1) {
    const repoPath = repos[0].git.repoPath
    if (question) {
      await askQuestion(ctx, clients, question, repoPath)
    } else {
      pendingAsk.set(ctx.chat!.id, { repoPath })
      const gitInfo = await gitStatusLines(repos[0].git)
      await ctx.reply(
        `📂 Using <code>${escapeHtml(repoLabel(repos[0]))}</code>${gitInfo}\n\nType your question:`,
        { parse_mode: "HTML" },
      )
    }
    return
  }

  // Multiple repos — show picker; stash inline question if present
  pendingAsk.set(ctx.chat!.id, { ...(question ? { inlineQuestion: question } : {}) })
  await showRepoPicker(ctx, repos)
}

export async function handleAskRepoChoice(
  ctx: Context,
  clients: Clients,
  idx: number,
): Promise<void> {
  const repos = clients.gitMap ? flatRepos(clients.gitMap) : []
  const entry = repos[idx]

  if (!entry) {
    await ctx.answerCallbackQuery("Repo not found")
    return
  }

  await ctx.answerCallbackQuery()

  const chatId = ctx.chat!.id
  const pending = pendingAsk.get(chatId)
  const repoPath = entry.git.repoPath

  if (pending?.inlineQuestion) {
    pendingAsk.delete(chatId)
    await askQuestion(ctx, clients, pending.inlineQuestion, repoPath)
    return
  }

  pendingAsk.set(chatId, { repoPath })
  const gitInfo = await gitStatusLines(entry.git)
  await ctx.reply(
    `📂 <code>${escapeHtml(repoLabel(entry))}</code> selected.${gitInfo}\n\nType your question:`,
    { parse_mode: "HTML" },
  )
}
