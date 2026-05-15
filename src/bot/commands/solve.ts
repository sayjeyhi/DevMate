import type { Context } from "grammy"
import { JiraAuthError, JiraNotFoundError, ClaudeTimeoutError, ClaudeExitError } from "../../shared/errors"
import { parseArgs } from "../utils/parseArgs"
import { splitMessage } from "../utils/splitMessage"

// TODO: replace with import from '../commands/index' once section-07 is complete
interface Clients {
  jira: {
    getIssue(key: string): Promise<{ key: string; summary: string; status: string; description: string }>
  }
  claude: {
    ask(prompt: string): Promise<string>
  }
}

export const SOLVE_PROMPT_TEMPLATE = `You are a software engineer analyzing a Jira issue. Provide actionable next steps or a solution approach.

<key>{KEY}</key>
<title>{TITLE}</title>
<status>{STATUS}</status>
<description>{DESCRIPTION}</description>

Analyze the issue and respond with:
1. A brief assessment of the problem
2. Concrete next steps or a solution approach
3. Any potential blockers or risks to consider

Be concise and practical.`

export async function handleSolve(ctx: Context, clients: Clients): Promise<void> {
  const args = parseArgs(ctx)
  const key = args[0]

  if (!key) {
    await ctx.reply("Usage: /solve <ticket-key>")
    return
  }

  await ctx.reply(`Analyzing ${key} with Claude...`)

  let typingInterval: ReturnType<typeof setInterval> | undefined

  try {
    await ctx.replyWithChatAction("typing")
    typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {})
    }, 4000)

    const issue = await clients.jira.getIssue(key)

    // Replace {PLACEHOLDER} tokens with issue fields wrapped in XML delimiters.
    // Description content is placed inside tags (not concatenated raw) to signal
    // to Claude that it is data, not instructions — prompt injection defense.
    // Null description coerced to empty string to avoid "null" in prompt.
    const prompt = SOLVE_PROMPT_TEMPLATE
      .replace("{KEY}", issue.key)
      .replace("{TITLE}", issue.summary)
      .replace("{STATUS}", issue.status)
      .replace("{DESCRIPTION}", issue.description ?? "")

    const response = await clients.claude.ask(prompt)

    const chunks = splitMessage(response)
    for (const chunk of chunks) {
      await ctx.reply(chunk)
    }
  } catch (err) {
    if (err instanceof JiraNotFoundError) {
      await ctx.reply(`Ticket ${key} not found.`)
      return
    }
    if (err instanceof JiraAuthError) {
      await ctx.reply("Jira authentication failed. Check your API token.")
      return
    }
    if (err instanceof ClaudeTimeoutError) {
      await ctx.reply("Claude timed out. Please try again.")
      return
    }
    if (err instanceof ClaudeExitError) {
      await ctx.reply("Claude returned an error. Please try again.")
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    console.log({ event: "error", command: "solve", errorMessage: message })
    await ctx.reply("Something went wrong. Please try again.")
  } finally {
    if (typingInterval !== undefined) clearInterval(typingInterval)
  }
}
