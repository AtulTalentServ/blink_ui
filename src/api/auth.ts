import { apiUrl, timedFetch } from './blink'

export interface OtpRequestResponse {
  message: string
  deliveryMode: string
  expiresInSeconds: number
  resendAfterSeconds: number
  otp?: string | null
}

export interface AuthSessionResponse {
  token?: string | null
  email: string
  expiresAt: string
}

async function readError(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { message?: string }
    return parsed.message || text || `Request failed (${response.status})`
  } catch {
    return text || `Request failed (${response.status})`
  }
}

export interface AuthLoginConfig {
  allowedDomain: string
  gateRequired: boolean
  otpReveal: boolean
}

export async function fetchLoginConfig(): Promise<AuthLoginConfig> {
  const response = await timedFetch(apiUrl('/auth/config'))
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return response.json() as Promise<AuthLoginConfig>
}

export async function requestLoginOtp(email: string): Promise<OtpRequestResponse> {
  // Login must tolerate Neon pool recovery after wizard autosave storms (default timedFetch is 15s).
  const response = await timedFetch(
    apiUrl('/auth/otp/request'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    },
    45_000,
  )
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return response.json() as Promise<OtpRequestResponse>
}

export async function verifyLoginOtp(email: string, otp: string): Promise<AuthSessionResponse> {
  const response = await timedFetch(
    apiUrl('/auth/otp/verify'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    },
    45_000,
  )
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return response.json() as Promise<AuthSessionResponse>
}

const SEND_CODE_FAILED = 'We could not send the sign-in code. Try again in a moment.'

/** Parses Go/Java OTP cooldown errors ("wait N seconds before requesting another code"). */
export function parseOtpResendWaitSeconds(message: string): number | null {
  const match = message.match(/wait (\d+) seconds before requesting/i)
  if (!match) return null
  const secs = Number(match[1])
  return Number.isFinite(secs) && secs > 0 ? secs : null
}

export function isOtpResendCooldownError(message: string): boolean {
  return /wait (\d+ )?seconds before requesting/i.test(message) || /wait before requesting another code/i.test(message)
}

function isInternalAuthDetail(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('smtp') ||
    lower.includes('gmail') ||
    lower.includes('oauth2.googleapis') ||
    lower.includes('port 587') ||
    lower.includes('port 465') ||
    lower.includes('office 365') ||
    lower.includes('blink_otp') ||
    lower.includes('javamail') ||
    lower.includes('mail.smtp') ||
    lower.includes('mail server') ||
    lower.includes('not configured') ||
    lower.includes("couldn't connect") ||
    lower.includes('connection refused')
  )
}

/** Short copy for the login card. Logs transport/config details instead of rendering them. */
export function toUserAuthError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message.trim() : ''
  if (!raw) return fallback
  if (isInternalAuthDetail(raw)) {
    console.warn('[login]', raw)
    return fallback || SEND_CODE_FAILED
  }
  return raw
}

export function publicOtpSentMessage(
  email: string,
  revealed: boolean,
  deliveryMode?: string,
): string {
  if (revealed) return 'Enter the 6-digit code shown below.'
  if (deliveryMode === 'gmail') {
    return `We sent a 6-digit code to ${email} via Gmail. Check Spam if it is missing.`
  }
  return `We sent a 6-digit code to ${email}.`
}

/** Show the issued OTP only in developer mode, or Vite local when the API is in SMTP-off reveal. */
export function shouldRevealLoginOtp(
  code: string | null | undefined,
  options: { otpReveal: boolean; developerEnabled: boolean; deliveryMode?: string },
): boolean {
  if (!code?.trim()) return false
  if (options.developerEnabled) return true
  const smtpOff = options.otpReveal || options.deliveryMode === 'local'
  return Boolean(smtpOff && import.meta.env.DEV)
}
