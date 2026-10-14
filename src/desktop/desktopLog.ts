/** Dev-friendly desktop shell logging (visible in WebView devtools). */
export function logDesktop(scope: string, detail: unknown): void {
  const prefix = `[blink-desktop:${scope}]`
  if (detail instanceof Error) {
    console.error(prefix, detail.message, detail)
    return
  }
  console.error(prefix, detail)
}
