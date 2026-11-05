import { Fragment, type ReactNode } from 'react'

const KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|type|interface|package|func|def|async|await|public|private)\b/g

function highlight(code: string): ReactNode[] {
  const parts = code.split(KEYWORDS)
  return parts.map((part, index) => (
    index % 2 === 1
      ? <span key={index} className="codex-md__kw">{part}</span>
      : <Fragment key={index}>{part}</Fragment>
  ))
}

function inline(text: string, onOpenFile?: (path: string) => void): ReactNode[] {
  const re = /(`[^`]+`|@[\w./-]+|\[[^\]]+\]\([^)]+\))/g
  const bits = text.split(re)
  return bits.map((bit, index) => {
    if (bit.startsWith('`') && bit.endsWith('`')) {
      return <code key={index}>{bit.slice(1, -1)}</code>
    }
    if (bit.startsWith('@') && onOpenFile) {
      const path = bit.slice(1)
      return (
        <button key={index} type="button" className="codex-file-chip" onClick={() => onOpenFile(path)}>
          {bit}
        </button>
      )
    }
    const link = bit.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) {
      return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>
    }
    return <Fragment key={index}>{bit}</Fragment>
  })
}

function readableProse(text: string): string {
  const chunks = (text || '').split(/(```[\s\S]*?```)/g)
  return chunks.map((chunk) => {
    if (chunk.startsWith('```')) return chunk
    return chunk
      .replace(/([.!?])([A-Z“"])/g, '$1\n\n$2')
      .replace(/[ \t]+\n/g, '\n')
  }).join('')
}

export function CodexMarkdown({ text, onOpenFile }: { text: string; onOpenFile?: (path: string) => void }) {
  const lines = readableProse(text).replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i])
        i += 1
      }
      blocks.push(
        <pre key={blocks.length} className="codex-md__pre" data-lang={lang}>
          <code>{highlight(buf.join('\n'))}</code>
        </pre>,
      )
      i += 1
      continue
    }
    if (line.startsWith('|') && lines[i + 1]?.includes('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim())
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells)
        i += 1
      }
      blocks.push(
        <table key={blocks.length} className="codex-md__table">
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{inline(cell, onOpenFile)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      )
      continue
    }
    if (line.startsWith('### ')) {
      blocks.push(<h4 key={blocks.length}>{inline(line.slice(4), onOpenFile)}</h4>)
    } else if (line.startsWith('## ')) {
      blocks.push(<h3 key={blocks.length}>{inline(line.slice(3), onOpenFile)}</h3>)
    } else if (line.startsWith('# ')) {
      blocks.push(<h2 key={blocks.length}>{inline(line.slice(2), onOpenFile)}</h2>)
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: string[] = []
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(lines[i].slice(2))
        i += 1
      }
      blocks.push(<ul key={blocks.length}>{items.map((item, n) => <li key={n}>{inline(item, onOpenFile)}</li>)}</ul>)
      continue
    } else if (line.trim()) {
      blocks.push(<p key={blocks.length}>{inline(line, onOpenFile)}</p>)
    }
    i += 1
  }
  return <div className="codex-md">{blocks}</div>
}
