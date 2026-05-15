import { describe, it, expect } from "bun:test"
import { splitMessage } from "../../../src/bot/utils/splitMessage"

const LIMIT = 4096

describe("splitMessage", () => {
  it("short text returned as single element without prefix", () => {
    const result = splitMessage("hello world")
    expect(result).toHaveLength(1)
    expect(result[0]).toBe("hello world")
  })

  it("text at exact limit returned as single element without prefix", () => {
    const text = "a".repeat(LIMIT)
    const result = splitMessage(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(text)
  })

  it("text one char over limit → two prefixed chunks", () => {
    const text = "a".repeat(LIMIT + 1)
    const result = splitMessage(text)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatch(/^\[1\/2\]/)
    expect(result[1]).toMatch(/^\[2\/2\]/)
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(LIMIT)
    }
  })

  it("splits at \\n\\n boundaries; first chunk contains both para1 and para2 joined with \\n\\n", () => {
    const para1 = "a".repeat(100)
    const para2 = "b".repeat(100)
    const para3 = "c".repeat(100)
    // effectiveLimit=242: para1+\n\n+para2=202 fits; adding para3 would be 304 > 242
    const text = `${para1}\n\n${para2}\n\n${para3}`
    const result = splitMessage(text, 250)
    expect(result).toHaveLength(2)
    const first = result[0].replace(/^\[\d+\/\d+\] /, "")
    expect(first).toBe(`${para1}\n\n${para2}`)
    const second = result[1].replace(/^\[\d+\/\d+\] /, "")
    expect(second).toBe(para3)
  })

  it("splits at last space when no paragraph boundary available — no mid-word cuts", () => {
    const words = Array.from({ length: 20 }, (_, i) => `word${i}`.padEnd(10, "x"))
    const text = words.join(" ")
    const result = splitMessage(text, 100)
    expect(result.length).toBeGreaterThan(1)
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(100)
      // Every word token in a chunk should be a complete word (no partial wordXX)
      const content = chunk.replace(/^\[\d+\/\d+\] /, "")
      for (const token of content.split(" ")) {
        expect(words.some(w => w === token)).toBe(true)
      }
    }
  })

  it("hard cuts a word with no spaces (no infinite loop)", () => {
    const bigWord = "x".repeat(300)
    const result = splitMessage(bigWord, 100)
    expect(result.length).toBeGreaterThan(1)
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(100)
    }
  })

  it("10-part split has correct [N/10] prefixes", () => {
    // Create text that forces 10+ splits at limit=100
    const text = Array.from({ length: 10 }, () => "a".repeat(90)).join(" ")
    const result = splitMessage(text, 100)
    expect(result.length).toBeGreaterThanOrEqual(10)
    const total = result.length
    result.forEach((chunk, i) => {
      expect(chunk.startsWith(`[${i + 1}/${total}]`)).toBe(true)
    })
  })

  it("prefixed chunks never exceed LIMIT characters", () => {
    const text = "word ".repeat(1500)
    const result = splitMessage(text)
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(LIMIT)
    }
  })

  it("empty string returns ['']", () => {
    // Defined behavior: empty input → single empty element (no split needed)
    expect(splitMessage("")).toEqual([""])
  })
})
