const PREFIX_RESERVE = 8 // "[99/99] "

/**
 * Splits text into chunks that fit within `limit` characters (default 4096).
 * Splits preferentially at \n\n paragraph boundaries, then at word boundaries,
 * then hard-cuts as a last resort.
 * When more than one chunk is produced, each chunk is prefixed [N/M].
 * Reserves 8 characters per chunk for the prefix to ensure prefixed chunks
 * never exceed `limit`.
 */
export function splitMessage(text: string, limit = 4096): string[] {
  if (text.length <= limit) return [text]

  const effectiveLimit = limit - PREFIX_RESERVE
  const chunks: string[] = []

  function pushLongText(str: string) {
    let remaining = str
    while (remaining.length > effectiveLimit) {
      const slice = remaining.slice(0, effectiveLimit)
      const lastSpace = slice.lastIndexOf(" ")
      if (lastSpace > 0) {
        chunks.push(remaining.slice(0, lastSpace))
        remaining = remaining.slice(lastSpace + 1)
      } else {
        // Hard cut — prevents infinite loop on text with no spaces
        chunks.push(remaining.slice(0, effectiveLimit))
        remaining = remaining.slice(effectiveLimit)
      }
    }
    return remaining
  }

  const paragraphs = text.split("\n\n")
  let current = ""

  for (const para of paragraphs) {
    if (para.length > effectiveLimit) {
      if (current) {
        chunks.push(current)
        current = ""
      }
      current = pushLongText(para)
    } else {
      const candidate = current ? `${current}\n\n${para}` : para
      if (candidate.length > effectiveLimit) {
        if (current) chunks.push(current)
        current = para
      } else {
        current = candidate
      }
    }
  }

  if (current) chunks.push(current)

  if (chunks.length > 1) {
    const total = chunks.length
    return chunks.map((chunk, i) => `[${i + 1}/${total}] ${chunk}`)
  }

  return chunks
}
