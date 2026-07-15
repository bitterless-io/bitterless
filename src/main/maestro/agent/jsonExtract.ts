// Extract a JSON object from model / free-text output. Tries a fenced ```json
// block first, then scans for the first BALANCED top-level {...} that parses —
// robust to prose (and stray braces) before or after the object.
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    const v = tryParse(fenced[1])
    if (v !== undefined) return v
  }
  return scanBalanced(text)
}

function scanBalanced(text: string): unknown {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < text.length; i += 1) {
      const c = text[i]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === '{') depth += 1
      else if (c === '}') {
        depth -= 1
        if (depth === 0) {
          const v = tryParse(text.slice(start, i + 1))
          if (v !== undefined) return v
          break // this start didn't parse; advance to the next '{'
        }
      }
    }
  }
  return null
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw.trim())
  } catch {
    return undefined
  }
}
