import { describe, it, expect } from "bun:test"
import { parseArgs, parseFirstAndRest } from "../../../src/bot/utils/parseArgs"

describe("parseArgs", () => {
  function ctx(match: string) {
    return { match } as never
  }

  it("empty match string → []", () => {
    expect(parseArgs(ctx(""))).toEqual([])
  })

  it("single token", () => {
    expect(parseArgs(ctx("ENG-1"))).toEqual(["ENG-1"])
  })

  it("multiple tokens split on whitespace", () => {
    expect(parseArgs(ctx("ENG-1 In Progress"))).toEqual(["ENG-1", "In", "Progress"])
  })

  it("extra surrounding and internal whitespace trimmed and filtered", () => {
    expect(parseArgs(ctx("  ENG-1   In  Progress  "))).toEqual(["ENG-1", "In", "Progress"])
  })

  it("undefined match → []", () => {
    expect(parseArgs({ match: undefined } as never)).toEqual([])
  })
})

describe("parseFirstAndRest", () => {
  it("preserves multiple spaces in remainder", () => {
    expect(parseFirstAndRest("ENG-1 Hello   world")).toEqual({
      first: "ENG-1",
      rest: "Hello   world",
    })
  })

  it("single token → null", () => {
    expect(parseFirstAndRest("ENG-1")).toBeNull()
  })

  it("empty string → null", () => {
    expect(parseFirstAndRest("")).toBeNull()
  })

  it("trailing space after first token → { first, rest: '' }", () => {
    // Regex /^(\S+)\s+([\s\S]*)$/ matches: rest is empty string, not null
    expect(parseFirstAndRest("ENG-1 ")).toEqual({ first: "ENG-1", rest: "" })
  })
})
