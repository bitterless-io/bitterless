// Minimal, dependency-free markdown -> safe HTML for the chat bubbles.
// HTML is escaped FIRST, then a small set of markdown constructs are applied,
// so the output is safe to bind with v-html for local agent output.
// (Faithful in spirit to bitterless's markstream-vue; swap that in later if the
// heavy peer deps — mermaid/d2/monaco/shiki/katex — become worth pulling.)

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(text: string): string {
  return (
    text
      // Links first, so the URL (group 2) lands in href before code/bold passes
      // can touch the label. Only http(s) is allowed through (escapeHtml already ran).
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  )
}

export function renderMarkdown(raw: string): string {
  const lines = escapeHtml(raw ?? '').split('\n')
  const out: string[] = []
  let inCode = false
  let codeBuf: string[] = []
  let listBuf: string[] = []
  let paraBuf: string[] = []

  const flushList = (): void => {
    if (listBuf.length) {
      out.push(`<ul>${listBuf.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`)
      listBuf = []
    }
  }
  const flushPara = (): void => {
    if (paraBuf.length) {
      out.push(`<p>${paraBuf.map((l) => inline(l)).join('<br>')}</p>`)
      paraBuf = []
    }
  }

  for (const line of lines) {
    const fence = line.trimStart().startsWith('```')
    if (fence) {
      if (inCode) {
        out.push(`<pre><code>${codeBuf.join('\n')}</code></pre>`)
        codeBuf = []
        inCode = false
      } else {
        flushPara()
        flushList()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushPara()
      flushList()
      const level = Math.min(6, heading[1].length)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) {
      flushPara()
      listBuf.push(bullet[1])
      continue
    }
    if (line.trim() === '') {
      flushPara()
      flushList()
      continue
    }
    flushList()
    paraBuf.push(line)
  }
  if (inCode) out.push(`<pre><code>${codeBuf.join('\n')}</code></pre>`)
  flushPara()
  flushList()
  return out.join('\n')
}
