import { RichMarkdown } from './RichMarkdown'

/** Markdown document block for requirements, grooming, digests, etc. */
export function DocMarkdown({ text, className = '' }: { text: string; className?: string }) {
  if (!String(text ?? '').trim()) return null
  return (
    <div className={`doc-markdown${className ? ` ${className}` : ''}`}>
      <RichMarkdown text={text} />
    </div>
  )
}
