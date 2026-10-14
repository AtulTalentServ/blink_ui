import { memo, useMemo, type ReactNode } from 'react'

type Props = { text: string; className?: string; /** Skip full parse while tokens stream in. */ streaming?: boolean }

/** Rich Markdown → React (headings, lists, code, tables, quotes; safe links only). */
export const RichMarkdown = memo(function RichMarkdown({ text, className = '', streaming = false }: Props) {
  const blocks = useMemo(() => (streaming ? [] : splitBlocks(text)), [text, streaming])
  if (streaming) {
    return (
      <div className={`rich-md chat-md rich-md-stream${className ? ` ${className}` : ''}`}>
        {text}
      </div>
    )
  }
  return (
    <div className={`rich-md chat-md${className ? ` ${className}` : ''}`}>
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          return (
            <pre key={i} className="chat-md-pre rich-md-pre">
              {block.lang ? <div className="rich-md-pre__lang">{block.lang}</div> : null}
              <code>{block.value}</code>
            </pre>
          )
        }
        if (block.type === 'blockquote') {
          return (
            <blockquote key={i} className="rich-md-quote">
              {block.lines.map((line, j) => (
                <p key={j}>{renderInline(line)}</p>
              ))}
            </blockquote>
          )
        }
        if (block.type === 'hr') {
          return <hr key={i} className="rich-md-hr" />
        }
        if (block.type === 'table') {
          return (
            <div key={i} className="rich-md-table-wrap">
              <table className="rich-md-table">
                <thead>
                  <tr>
                    {block.header.map((cell, j) => (
                      <th key={j}>{renderInline(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci}>{renderInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (block.type === 'ul') {
          return (
            <ul key={i} className="chat-md-ul">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          )
        }
        if (block.type === 'ol') {
          return (
            <ol key={i} className="chat-md-ol">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ol>
          )
        }
        if (block.type === 'h') {
          const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6')
          const sizeClass = block.level <= 3 ? `chat-md-h${block.level}` : 'rich-md-h-deep'
          return (
            <Tag key={i} className={`chat-md-h ${sizeClass}`}>
              {renderInline(block.value)}
            </Tag>
          )
        }
        return (
          <p key={i} className="chat-md-p">
            {renderInline(block.value)}
          </p>
        )
      })}
    </div>
  )
})

type Block =
  | { type: 'p'; value: string }
  | { type: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; value: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'code'; lang?: string; value: string }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'hr' }
  | { type: 'table'; header: string[]; rows: string[][] }

function splitBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      out.push({ type: 'hr' })
      i += 1
      continue
    }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || undefined
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) {
        body.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      out.push({ type: 'code', lang, value: body.join('\n') })
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      const level = Math.min(6, heading[1].length) as 1 | 2 | 3 | 4 | 5 | 6
      out.push({ type: 'h', level, value: heading[2] })
      i += 1
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      out.push({ type: 'blockquote', lines: quoteLines })
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s\-:|]+\|?\s*$/.test(lines[i + 1])) {
      const parseRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim())
      const header = parseRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(parseRow(lines[i]))
        i += 1
      }
      out.push({ type: 'table', header, rows })
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i += 1
      }
      out.push({ type: 'ul', items })
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i += 1
      }
      out.push({ type: 'ol', items })
      continue
    }
    if (!line.trim()) {
      i += 1
      continue
    }
    const para: string[] = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('```') &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())
    ) {
      para.push(lines[i])
      i += 1
    }
    out.push({ type: 'p', value: para.join('\n') })
  }
  return out.length ? out : [{ type: 'p', value: '' }]
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('`')) {
      nodes.push(
        <code key={key++} className="chat-md-code">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key++}>{token.slice(2, -2)}</del>)
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith('[')) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (m && isSafeHref(m[2])) {
        nodes.push(
          <a key={key++} href={m[2]} target="_blank" rel="noreferrer">
            {m[1]}
          </a>,
        )
      } else {
        nodes.push(token)
      }
    } else {
      nodes.push(token)
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim())
}
