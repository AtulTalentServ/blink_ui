import { RichMarkdown } from '../components/RichMarkdown'

/** Markdown for Cursor agent replies in the desktop panel. */
export function CursorAgentMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return <RichMarkdown text={text} className="cursor-agent-md" streaming={streaming} />
}
