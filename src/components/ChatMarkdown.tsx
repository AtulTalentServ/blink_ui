import { RichMarkdown } from './RichMarkdown'

/** Markdown for Blink Chat replies. */
export function ChatMarkdown({ text }: { text: string }) {
  return <RichMarkdown text={text} />
}
