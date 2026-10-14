import { RichMarkdown } from '../components/RichMarkdown'

/** Markdown for Cursor agent replies in the desktop panel. */
export function CursorAgentMarkdown({ text }: { text: string }) {
  return <RichMarkdown text={text} className="cursor-agent-md" />
}
