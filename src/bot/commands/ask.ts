import type { Context } from "grammy"
import type { Clients } from "./index"
import { ClaudeTimeoutError, ClaudeExitError } from "../../shared/errors"
import { escapeHtml } from "./my-tickets"
import { splitMessage } from "../utils/splitMessage"
import type { GitClient } from "../../git/GitClient"

// ─── Types ───────────────────────────────────────────────────────────────────

interface RepoEntry {
  projKey: string
  git: GitClient
}

interface HistoryEntry {
  role: "user" | "assistant"
  content: string
}

interface AskSession {
  repoPath?: string
  git?: GitClient
  history: HistoryEntry[]
}

interface PendingAsk {
  repoPath?: string
  inlineQuestion?: string
  mode?: "followup" | "branch" | "commit"
}

type SessionButton = { text: string; callback_data: string }

// ─── State ───────────────────────────────────────────────────────────────────

export const pendingAsk = new Map<number, PendingAsk>()
export const askSessions = new Map<number, AskSession>()

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function sessionKeyboard(withPr = false): { inline_keyboard: SessionButton[][] } {
  const rows: SessionButton[][] = [
    [
      { text: "💬 Follow up", callback_data: "ask:followup" },
      { text: "🌿 Branch", callback_data: "ask:branch" },
    ],
    [
      { text: "📤 Push", callback_data: "ask:push" },
      { text: "🔚 End session", callback_data: "ask:end" },
    ],
    [{ text: "📝 Commit", callback_data: "ask:commit" }],
  ]
  if (withPr) rows.unshift([{ text: "🔗 Open PR", callback_data: "ask:openpr" }])
  return { inline_keyboard: rows }
}

function buildPrompt(question: string, history: HistoryEntry[]): string {
  if (history.length === 0) return question
  const turns = history
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n")
  return `This is a continuing conversation. Previous exchanges:\n\n${turns}\n\nUser: ${question}`
}

// ─── Core ask ────────────────────────────────────────────────────────────────

async function askWithSession(
  ctx: Context,
  clients: Clients,
  question: string,
  session: AskSession,
): Promise<void> {
  const chatId = ctx.chat!.id
  const { repoPath } = session
  const label = repoPath
    ? `<code>${escapeHtml(repoPath.split("/").at(-1) ?? repoPath)}</code>`
    : "no repo context"

  const progressMsg = await ctx.reply(`🤔 Asking Claude (${label})…`, { parse_mode: "HTML" })
  const msgId = progressMsg.message_id

  const edit = async (text: string) => {
    try { await ctx.api.editMessageText(chatId, msgId, text, { parse_mode: "HTML" }) } catch {}
  }

  const HEADER = `🤔 Asking Claude (${label})…\n\n`
  const MAX_CONTENT = 4096 - HEADER.length - 13

  function buildProgressMsg(lines: string[]): string {
    const raw = lines.map(escapeHtml).join("\n")
    const content = raw.length > MAX_CONTENT
      ? "…\n" + raw.slice(raw.length - (MAX_CONTENT - 2))
      : raw
    return `${HEADER}<pre>${content}</pre>`
  }

  try {
    await ctx.replyWithChatAction("typing")
    const response = await clients.claude.ask(buildPrompt(question, session.history), {
      cwd: repoPath,
      onProgress: async (lines: string[]) => { await edit(buildProgressMsg(lines)) },
    })

    session.history.push({ role: "user", content: question })
    session.history.push({ role: "assistant", content: response })
    askSessions.set(chatId, session)

    await edit(`✅ Done (${label})`)
    for (const chunk of splitMessage(response)) {
      await ctx.reply(chunk)
    }

    const gitInfo = session.git ? await gitStatusLines(session.git) : ""
    await ctx.reply(`What would you like to do next?${gitInfo}`, {
      parse_mode: "HTML",
      reply_markup: sessionKeyboard(),
    })
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

// ─── Public ask entry (also used by initial /ask flow) ───────────────────────

export async function askQuestion(
  ctx: Context,
  clients: Clients,
  question: string,
  repoPath?: string,
  git?: GitClient,
): Promise<void> {
  const chatId = ctx.chat!.id
  const existing = askSessions.get(chatId)
  const session: AskSession = existing ?? { repoPath, git, history: [] }
  await askWithSession(ctx, clients, question, session)
}

// ─── Text input dispatcher (called from commands/index.ts interceptor) ────────

export async function handleAskTextInput(
  ctx: Context,
  clients: Clients,
  text: string,
  pending: PendingAsk,
): Promise<void> {
  const chatId = ctx.chat!.id

  if (pending.mode === "branch") {
    const session = askSessions.get(chatId)
    const git = session?.git
    if (!git) {
      await ctx.reply("No repo in this session — cannot create branch.")
      return
    }
    const branchName = text.trim().replace(/\s+/g, "-")
    try {
      await ctx.replyWithChatAction("typing")
      await git.checkoutNewBranchFromMain(branchName)
      const gitInfo = await gitStatusLines(git)
      await ctx.reply(`✅ Branch <code>${escapeHtml(branchName)}</code> created.${gitInfo}`, {
        parse_mode: "HTML",
        reply_markup: sessionKeyboard(),
      })
    } catch (err) {
      await ctx.reply(`❌ Branch creation failed: ${escapeHtml((err as Error).message)}`, {
        parse_mode: "HTML",
      })
    }
    return
  }

  if (pending.mode === "commit") {
    const session = askSessions.get(chatId)
    const git = session?.git
    if (!git) {
      await ctx.reply("No repo in this session — cannot commit.")
      return
    }
    try {
      await ctx.replyWithChatAction("typing")
      await git.stageAll()
      await git.commit(text.trim())
      const gitInfo = await gitStatusLines(git)
      await ctx.reply(`✅ Committed: <i>${escapeHtml(text.trim())}</i>${gitInfo}`, {
        parse_mode: "HTML",
        reply_markup: sessionKeyboard(),
      })
    } catch (err) {
      await ctx.reply(`❌ Commit failed: ${escapeHtml((err as Error).message)}`, {
        parse_mode: "HTML",
      })
    }
    return
  }

  // mode === 'followup' or undefined (initial question)
  const session = askSessions.get(chatId) ?? { repoPath: pending.repoPath, history: [] }
  await askWithSession(ctx, clients, text, session)
}

// ─── Session callback handler (called from commands/index.ts) ─────────────────

export async function handleAskSessionCallback(
  ctx: Context,
  clients: Clients,
  action: string,
): Promise<void> {
  const chatId = ctx.chat!.id
  const session = askSessions.get(chatId)

  if (action === "followup") {
    await ctx.answerCallbackQuery()
    pendingAsk.set(chatId, { repoPath: session?.repoPath, mode: "followup" })
    await ctx.reply("💬 Type your follow-up question:")
    return
  }

  if (action === "branch") {
    await ctx.answerCallbackQuery()
    if (!session?.git) {
      await ctx.reply("No repo in this session — cannot create branch.")
      return
    }
    pendingAsk.set(chatId, { repoPath: session.repoPath, mode: "branch" })
    await ctx.reply("🌿 Enter branch name:")
    return
  }

  if (action === "openpr") {
    await ctx.answerCallbackQuery()
    const git = session?.git
    if (!git) { await ctx.reply("No repo in this session."); return }
    try {
      await ctx.replyWithChatAction("typing")
      const url = await git.createPr()
      await ctx.reply(`🔗 <a href="${url}">Open Pull Request</a>`, {
        parse_mode: "HTML",
        reply_markup: sessionKeyboard(),
      })
    } catch (err) {
      await ctx.reply(`❌ PR failed: ${escapeHtml((err as Error).message)}`, { parse_mode: "HTML" })
    }
    return
  }

  if (action === "commit") {
    await ctx.answerCallbackQuery()
    const git = session?.git
    if (!git) { await ctx.reply("No repo in this session — cannot commit."); return }
    try {
      const clean = await git.isClean()
      if (clean) {
        await ctx.reply("Nothing to commit — working tree is clean.", {
          reply_markup: sessionKeyboard(),
        })
        return
      }
    } catch { /* continue */ }
    pendingAsk.set(chatId, { repoPath: session?.repoPath, mode: "commit" })
    const gitInfo = await gitStatusLines(git)
    await ctx.reply(`📝 Enter commit message:${gitInfo}`, { parse_mode: "HTML" })
    return
  }

  if (action === "push") {
    await ctx.answerCallbackQuery()
    const git = session?.git
    if (!git) { await ctx.reply("No repo in this session."); return }
    try {
      await ctx.replyWithChatAction("typing")
      const branch = await git.currentBranch()
      if (branch === "main" || branch === "master") {
        await ctx.reply(
          `⚠️ On <code>${escapeHtml(branch)}</code> — create a branch first before pushing.`,
          { parse_mode: "HTML", reply_markup: sessionKeyboard() },
        )
        return
      }
      await git.push()
      const gitInfo = await gitStatusLines(git)
      await ctx.reply(`✅ Pushed <code>${escapeHtml(branch)}</code> to origin.${gitInfo}`, {
        parse_mode: "HTML",
        reply_markup: sessionKeyboard(true),
      })
    } catch (err) {
      await ctx.reply(`❌ Push failed: ${escapeHtml((err as Error).message)}`, { parse_mode: "HTML" })
    }
    return
  }

  if (action === "end") {
    askSessions.delete(chatId)
    await ctx.answerCallbackQuery("Session ended")
    await ctx.editMessageReplyMarkup()
    await ctx.reply("🔚 Session ended.")
    return
  }

  await ctx.answerCallbackQuery()
}

// ─── /ask command entry ───────────────────────────────────────────────────────

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
    const { git } = repos[0]
    const repoPath = git.repoPath
    if (question) {
      await askQuestion(ctx, clients, question, repoPath, git)
    } else {
      const chatId = ctx.chat!.id
      pendingAsk.set(chatId, { repoPath })
      askSessions.set(chatId, { repoPath, git, history: [] })
      const gitInfo = await gitStatusLines(git)
      await ctx.reply(
        `📂 Using <code>${escapeHtml(repoLabel(repos[0]))}</code>${gitInfo}\n\nType your question:`,
        { parse_mode: "HTML" },
      )
    }
    return
  }

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

  if (!entry) { await ctx.answerCallbackQuery("Repo not found"); return }
  await ctx.answerCallbackQuery()

  const chatId = ctx.chat!.id
  const pending = pendingAsk.get(chatId)
  const { git } = entry
  const repoPath = git.repoPath

  askSessions.set(chatId, { repoPath, git, history: [] })

  if (pending?.inlineQuestion) {
    pendingAsk.delete(chatId)
    await askQuestion(ctx, clients, pending.inlineQuestion, repoPath, git)
    return
  }

  pendingAsk.set(chatId, { repoPath })
  const gitInfo = await gitStatusLines(git)
  await ctx.reply(
    `📂 <code>${escapeHtml(repoLabel(entry))}</code> selected.${gitInfo}\n\nType your question:`,
    { parse_mode: "HTML" },
  )
}
