import { mock, describe, it, expect, spyOn, afterEach } from "bun:test"
import type { AppConfig } from "../../src/config/schema"

// Module-level state controlling mock behavior — updated per-test
type TextOpts = { message: string; initialValue?: string; validate?: (v: string) => string | undefined }
type GroupOpts = { onCancel: () => never }
type Prompts = Record<string, () => Promise<string>>

let _textImpl: (opts: TextOpts) => Promise<string> =
  ({ initialValue }) => Promise.resolve(initialValue ?? "")

let _groupImpl: (prompts: Prompts, opts: GroupOpts) => Promise<Record<string, string>> =
  async (prompts, _opts) => {
    const results: Record<string, string> = {}
    for (const [key, fn] of Object.entries(prompts)) {
      results[key] = await fn()
    }
    return results
  }

// Hoisted before imports by Bun — wizard.ts gets the mock @clack/prompts
mock.module("@clack/prompts", () => ({
  intro: () => {},
  outro: () => {},
  isCancel: () => false,
  group: (p: Prompts, o: GroupOpts) => _groupImpl(p, o),
  text: (o: TextOpts) => _textImpl(o),
}))

import { runWizard } from "../../src/config/wizard"
import { FriendlyError } from "../../src/shared/errors"
import {
  validateBotToken,
  validateJiraBaseUrl,
  validateApiToken,
  validateEmail,
  validateProjectKey,
} from "../../src/config/validators"

afterEach(() => {
  _textImpl = ({ initialValue }) => Promise.resolve(initialValue ?? "")
  _groupImpl = async (prompts, _opts) => {
    const results: Record<string, string> = {}
    for (const [key, fn] of Object.entries(prompts)) results[key] = await fn()
    return results
  }
})

// Helper: force isTTY for tests that need the wizard to proceed past the TTY check
async function withTTY<T>(value: boolean, fn: () => Promise<T>): Promise<T> {
  const saved = process.stdin.isTTY
  ;(process.stdin as any).isTTY = value
  try { return await fn() } finally { ;(process.stdin as any).isTTY = saved }
}

// Valid values that produce a well-formed AppConfig when returned by the text mock
const VALID_VALUES: Record<string, string> = {
  "Telegram bot token": "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh",
  "Your Telegram user ID(s)": "12345",
  "Jira base URL": "https://myco.atlassian.net",
  "Jira API token": "mytoken",
  "Jira account email": "user@example.com",
  "Jira project key": "MYPROJECT",
  "Path to claude binary": "/usr/bin/true",
  "Anthropic API key": "",
}

function validTextImpl({ message, initialValue }: TextOpts): Promise<string> {
  for (const [substr, val] of Object.entries(VALID_VALUES)) {
    if (message.includes(substr)) return Promise.resolve(val)
  }
  return Promise.resolve(initialValue ?? "")
}

describe("runWizard", () => {
  it("throws FriendlyError in non-interactive (non-TTY) environment", async () => {
    let err: unknown
    try { await withTTY(false, () => runWizard()) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FriendlyError)
    expect((err as FriendlyError).message).toContain("non-interactive")
  })

  it("prompts for telegram.bot_token and validates format", () => {
    expect(validateBotToken("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef")).toBeUndefined()
    expect(validateBotToken("")).toBeTypeOf("string")
    expect(validateBotToken("notabot")).toBeTypeOf("string")
    expect(validateBotToken("123:short")).toBeTypeOf("string")
  })

  it("prompts for jira.base_url and validates HTTPS URL", () => {
    expect(validateJiraBaseUrl("https://myco.atlassian.net")).toBeUndefined()
    expect(validateJiraBaseUrl("http://myco.atlassian.net")).toBeTypeOf("string")
    expect(validateJiraBaseUrl("not-a-url")).toBeTypeOf("string")
    expect(validateJiraBaseUrl("")).toBeTypeOf("string")
  })

  it("prompts for jira.api_token (non-empty)", () => {
    expect(validateApiToken("any-token")).toBeUndefined()
    expect(validateApiToken("")).toBeTypeOf("string")
  })

  it("prompts for jira.email and validates format", () => {
    expect(validateEmail("user@example.com")).toBeUndefined()
    expect(validateEmail("not-an-email")).toBeTypeOf("string")
    expect(validateEmail("")).toBeTypeOf("string")
    expect(validateEmail("missing@tld")).toBeTypeOf("string")
  })

  it("prompts for jira.project_key and validates uppercase", () => {
    expect(validateProjectKey("MYPROJECT")).toBeUndefined()
    expect(validateProjectKey("myproject")).toBeTypeOf("string")
    expect(validateProjectKey("My Project")).toBeTypeOf("string")
    expect(validateProjectKey("123PROJ")).toBeTypeOf("string")
  })

  it("auto-fills claude.binary_path from PATH when not in existing config", async () => {
    const whichSpy = spyOn(Bun, "which").mockReturnValue("/auto/claude")
    const captured: Record<string, string | undefined> = {}
    _textImpl = ({ message, initialValue }) => {
      captured[message] = initialValue
      return Promise.resolve(initialValue ?? "")
    }

    await withTTY(true, () => runWizard())

    expect(whichSpy).toHaveBeenCalledWith("claude")
    expect(captured["Path to claude binary"]).toBe("/auto/claude")
    whichSpy.mockRestore()
  })

  it("preserves existing config values as initial values", async () => {
    const captured: Record<string, string | undefined> = {}
    _textImpl = ({ message, initialValue }) => {
      captured[message] = initialValue
      return Promise.resolve(initialValue ?? "")
    }

    const existing: AppConfig = {
      telegram: { bot_token: "111111:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef", allowed_user_ids: [42, 99] },
      jira: { base_url: "https://co.atlassian.net", api_token: "tok", email: "a@b.com", project_key: "PROJ" },
      claude: { binary_path: "/my/claude", api_key: "sk-ant-123" },
      app: { log_level: "info" },
    }

    await withTTY(true, () => runWizard(existing))

    expect(captured["Telegram bot token"]).toBe("111111:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef")
    expect(captured["Jira base URL (e.g. https://mycompany.atlassian.net)"]).toBe("https://co.atlassian.net")
    expect(captured["Jira API token"]).toBe("tok")
    expect(captured["Jira account email"]).toBe("a@b.com")
    expect(captured["Jira project key (e.g. MYPROJECT)"]).toBe("PROJ")
    expect(captured["Path to claude binary"]).toBe("/my/claude")
    expect(captured["Your Telegram user ID(s), comma-separated (send /start to @userinfobot to get yours)"]).toBe("42, 99")
  })

  it("throws FriendlyError on Ctrl+C cancel", async () => {
    _groupImpl = (_prompts, opts) => {
      opts.onCancel()
      return Promise.resolve({})
    }

    let err: unknown
    try { await withTTY(true, () => runWizard()) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FriendlyError)
  })

  it("returns AppConfig without writing to disk", async () => {
    _textImpl = validTextImpl

    const result = await withTTY(true, () => runWizard())

    expect(result).toMatchObject({
      telegram: expect.objectContaining({ bot_token: expect.any(String), allowed_user_ids: expect.any(Array) }),
      jira: expect.objectContaining({
        base_url: expect.any(String),
        api_token: expect.any(String),
        email: expect.any(String),
        project_key: expect.any(String),
      }),
      claude: expect.objectContaining({ binary_path: expect.any(String) }),
      app: expect.objectContaining({ log_level: expect.any(String) }),
    })
  })
})
