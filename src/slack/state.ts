import { PATHS } from "../shared/paths"

interface SlackState {
  lastTs: Record<string, string>
  // channelId → threadTs → lastReplyTs
  threadTs: Record<string, Record<string, string>>
}

export async function loadSlackState(): Promise<SlackState> {
  try {
    const text = await Bun.file(PATHS.slackStateFile).text()
    const parsed = JSON.parse(text) as Partial<SlackState>
    return { lastTs: parsed.lastTs ?? {}, threadTs: parsed.threadTs ?? {} }
  } catch {
    return { lastTs: {}, threadTs: {} }
  }
}

export async function saveSlackState(state: SlackState): Promise<void> {
  await Bun.write(PATHS.slackStateFile, JSON.stringify(state))
}
