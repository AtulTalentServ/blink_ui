export const DEVELOPER_POPUP_QUERY = 'blink-dev'
export const DEVELOPER_POPUP_NAME = 'blink-developer-tools'

export function isDeveloperPopupWindow(): boolean {
  return new URLSearchParams(window.location.search).get(DEVELOPER_POPUP_QUERY) === '1'
}

export function developerPopupHref(): string {
  const url = new URL(window.location.href)
  url.searchParams.set(DEVELOPER_POPUP_QUERY, '1')
  url.hash = ''
  return url.toString()
}

let popup: Window | null = null

export function openDeveloperPopup(): Window | null {
  if (popup && !popup.closed) {
    popup.focus()
    return popup
  }
  popup = window.open(
    developerPopupHref(),
    DEVELOPER_POPUP_NAME,
    'popup=yes,width=440,height=780,left=72,top=72,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes',
  )
  return popup
}

/** Popup when allowed; otherwise in-app panel (WebView2 / blocked popups). */
export function openDeveloperTools(): void {
  const opened = openDeveloperPopup()
  if (opened) {
    return
  }
  window.dispatchEvent(new CustomEvent('blink-developer-inapp-open', { bubbles: true }))
}
