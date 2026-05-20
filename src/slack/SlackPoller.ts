import type { SlackClient } from "./SlackClient"
import { SlackRateLimitError } from "./SlackClient"
import type { SlackChannel, SlackNewMessage } from "./types"
import { loadSlackState, saveSlackState } from "./state"

export type MessageHandler = (msg: SlackNewMessage) => Promise<void>
export type PollErrorHandler = (err: Error) => void

const CHANNEL_CACHE_TTL_MS = 5 * 60 * 1000 // refresh channel list every 5 minutes

export class SlackPoller {
  private handler?: MessageHandler
  private onError?: PollErrorHandler
  private readonly userCache = new Map<string, string>()
  private channelCache: SlackChannel[] = []
  private channelCacheAt = 0

  constructor(
    private readonly client: SlackClient,
    private readonly intervalMs: number,
  ) {}

  setErrorHandler(handler: PollErrorHandler): void {
    this.onError = handler
  }

  setMessageHandler(handler: MessageHandler): void {
    this.handler = handler
  }

  async start(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.poll()
        await Bun.sleep(this.intervalMs)
      } catch (err) {
        if (err instanceof SlackRateLimitError) {
          this.onError?.(err)
          await Bun.sleep(err.retryAfterSeconds * 1000)
        } else {
          this.onError?.(err as Error)
          await Bun.sleep(this.intervalMs)
        }
      }
    }
  }

  private async getChannels(): Promise<SlackChannel[]> {
    const now = Date.now()
    if (this.channelCache.length > 0 && now - this.channelCacheAt < CHANNEL_CACHE_TTL_MS) {
      return this.channelCache
    }
    this.channelCache = await this.client.listImChannels()
    this.channelCacheAt = now
    return this.channelCache
  }

  private async resolveUsername(userId: string): Promise<string> {
    const cached = this.userCache.get(userId)
    if (cached) return cached
    try {
      const user = await this.client.getUserInfo(userId)
      const name = user.profile?.display_name || user.real_name || user.name
      this.userCache.set(userId, name)
      return name
    } catch {
      return userId
    }
  }

  private async poll(): Promise<void> {
    if (!this.handler) return

    const state = await loadSlackState()
    const channels = await this.getChannels()
    const nowTs = (Date.now() / 1000).toFixed(6)
    let stateChanged = false

    for (const channel of channels) {
      const lastTs = state.lastTs[channel.id]

      if (!lastTs) {
        state.lastTs[channel.id] = nowTs
        stateChanged = true
        continue
      }

      const messages = await this.client.getHistory(channel.id, lastTs)
      const sorted = messages.slice().reverse()

      for (const msg of sorted) {
        if (!msg.user) continue
        const senderName = await this.resolveUsername(msg.user)
        await this.handler({ channel, message: msg, senderName })

        // track threads found in this channel
        if (msg.reply_count && msg.reply_count > 0) {
          if (!state.threadTs[channel.id]) state.threadTs[channel.id] = {}
          if (!state.threadTs[channel.id][msg.ts]) {
            state.threadTs[channel.id][msg.ts] = msg.ts
          }
        }
      }

      if (messages.length > 0) {
        state.lastTs[channel.id] = messages[0].ts
        stateChanged = true
      }

      // poll replies for tracked threads
      const threads = state.threadTs[channel.id] ?? {}
      for (const [threadTs, lastReplyTs] of Object.entries(threads)) {
        const replies = await this.client.getReplies(channel.id, threadTs, lastReplyTs)
        if (replies.length === 0) continue

        const sortedReplies = replies.slice().reverse()
        for (const reply of sortedReplies) {
          if (!reply.user) continue
          const senderName = await this.resolveUsername(reply.user)
          await this.handler({ channel, message: reply, senderName })
        }

        state.threadTs[channel.id][threadTs] = replies[0].ts
        stateChanged = true
      }
    }

    if (stateChanged) await saveSlackState(state)
  }
}
