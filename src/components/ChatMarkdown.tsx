import { RichMarkdown } from './RichMarkdown'

/** Markdown for Blink Chat replies. */
export function ChatMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return <RichMarkdown text={text} streaming={streaming} />
}
