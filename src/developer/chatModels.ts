export const CHAT_MODEL_STORAGE_KEY = 'blink.chatPanel.model'

export const CHAT_MODELS = [
  { id: 'gpt-5.6-luna', label: 'OpenAI Luna', hint: 'Fast' },
  { id: 'terra', label: 'OpenAI Terra', hint: 'Balanced' },
  { id: 'sol', label: 'OpenAI Sol', hint: 'Strong' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', hint: 'Fast' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', hint: 'Lightweight' },
] as const
