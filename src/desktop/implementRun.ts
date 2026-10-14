import { canRunDesktopImplementBatch } from './detect'
import type { ImplementRunState } from './implementRunTypes'
import { emptyImplementRunState, reduceImplementRunEvent } from './implementRunTypes'

type Unlisten = () => void

export type DesktopRunMode = 'batch' | 'chat'

export interface StartImplementBatchOptions {
  workspace: string
  runMode?: DesktopRunMode
  requirements?: string
  /** Project shape, repositories, and technology (Blink wizard). */
  architectureContext?: string
  chatMessage?: string
  useWorktree?: boolean
  worktreeName?: string
  provider?: 'cursor-cli'
  model?: string
  continueSession?: boolean
  /** Merge into initial run state (persisted conversation). */
  initialState?: Partial<ImplementRunState>
}

export async function startDesktopImplementBatch(
  options: StartImplementBatchOptions,
  onState: (state: ImplementRunState) => void,
): Promise<{ stop: () => Promise<void> }> {
  if (!canRunDesktopImplementBatch()) {
    throw new Error('Desktop implement batch is only available in the Blink desktop app.')
  }

  const tauri = (window as unknown as {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
      event: { listen: (event: string, handler: (ev: { payload: string }) => void) => Promise<Unlisten> }
    }
  }).__TAURI__

  let state: ImplementRunState = {
    ...emptyImplementRunState(),
    ...options.initialState,
    running: true,
  }
  onState(state)

  const unlisten = await tauri.event.listen('implement-run-event', (event) => {
    const payload = typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload)
    state = reduceImplementRunEvent(state, payload)
    onState({ ...state })
  })

  await tauri.core.invoke('run_implement_batch', {
    request: {
      workspace: options.workspace,
      runMode: options.runMode ?? 'batch',
      requirements: options.requirements ?? '',
      architectureContext: options.architectureContext ?? '',
      chatMessage: options.chatMessage ?? '',
      useWorktree: options.useWorktree ?? true,
      worktreeName: options.worktreeName ?? 'blink-implement',
      provider: options.provider ?? 'cursor-cli',
      model: options.model ?? 'auto',
      continueSession: options.continueSession ?? true,
    },
  })

  return {
    stop: async () => {
      await tauri.core.invoke('stop_implement_batch')
      unlisten()
      state = { ...state, running: false }
      onState(state)
    },
  }
}
