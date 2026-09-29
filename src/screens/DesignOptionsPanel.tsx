import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Layers, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import {
  clearFigmaDesign,
  fetchFigmaDesign,
  fetchFigmaFiles,
  ingestFigmaDesign,
  apiUrl,
  proposeStitchDesigns,
  saveFigmaDesign,
  type FigmaFileItem,
} from '../api/blink'
import type { DesignOption, WizardState, WizardStep } from '../wizard/types'
import { autoLinkFigmaScreens, designFromBinding, figmaJiraRefs, figmaStoryRefs } from '../wizard/figmaDesign'
import { jiraConnection } from '../wizard/jiraTickets'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  onNavigate?: (step: WizardStep) => void
}

function designImageSrc(url?: string): string {
  if (!url) return ''
  if (url.startsWith('data:') || /^https?:\/\//i.test(url)) return url
  const path = url.startsWith('/api/') ? url.slice(4) : url
  return apiUrl(path.startsWith('/') ? path : `/${path}`)
}

function parseFigmaFileKey(raw: string): string | undefined {
  const value = raw.trim()
  const match = value.match(/(?:file|design|proto)\/([A-Za-z0-9]{10,})/)
  if (match?.[1]) return match[1]
  if (/^[A-Za-z0-9]{22,}$/.test(value)) return value
  return undefined
}

function fileHref(fileKey?: string, fileUrl?: string): string {
  if (fileUrl?.trim()) return fileUrl.trim()
  if (fileKey) return `https://www.figma.com/design/${fileKey}`
  return 'https://www.figma.com/files'
}

const FIGMA_READ_LIMIT =
  'Figma has used up file reads for this file. A Starter file only allows a few reads per month, so waiting and clicking Sync will not load the screens. Duplicate the file into a Professional team where you have a Full or Dev seat, then bind that copy and sync once.'

function figmaActionError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : fallback
  if (/rate.?limit|paused file reads|used up file reads/i.test(message)) {
    return FIGMA_READ_LIMIT
  }
  if (/Could not read Figma file/i.test(message)) {
    return 'Could not refresh the Figma file. Reconnect Figma on Integrations, then try Sync from Figma again.'
  }
  return message || fallback
}

function isRateLimitCopy(value?: string | null): boolean {
  return /rate.?limit|paused file reads|used up file reads/i.test(value || '')
}

function rateLimitWaitMs(message: string): number {
  const match = message.match(/(\d+)\s*seconds/i)
  const seconds = match ? Number(match[1]) : 90
  if (!Number.isFinite(seconds) || seconds <= 0) return 600_000
  return Math.min(Math.max(seconds, 5), 1800) * 1000
}

function ScreenThumb({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [url])
  if (!url || failed) {
    return (
      <div className="design-screen-thumb is-empty" aria-hidden="true">
        <Layers size={16} />
      </div>
    )
  }
  return (
    <img
      className="design-screen-thumb"
      src={url}
      alt=""
      onError={() => setFailed(true)}
    />
  )
}

export function DesignOptionsPanel({ state, onUpdate, onNavigate }: Props) {
  const [error, setError] = useState<string | null>(null)
  const figma = state.integrations?.find((item) => item.id === 'figma')
  const figmaConnected = Boolean(figma?.connected)
  const design = state.figmaDesign
  const screens = design?.screens || []
  const hasFigmaFile = Boolean(design?.fileKey)
  const [showBind, setShowBind] = useState(false)
  const [fileUrl, setFileUrl] = useState(design?.fileUrl || '')
  const [figmaFiles, setFigmaFiles] = useState<FigmaFileItem[]>(design?.availableFiles || [])
  const [listingFiles, setListingFiles] = useState(false)
  const [binding, setBinding] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [thumbsTried, setThumbsTried] = useState(false)
  const [syncLockUntil, setSyncLockUntil] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [stitchOptions, setStitchOptions] = useState<DesignOption[]>(state.designOptions?.options || [])
  const [chosenId, setChosenId] = useState(state.designOptions?.chosenId || '')
  const [stitchMessage, setStitchMessage] = useState(state.designOptions?.message || '')

  useEffect(() => {
    setStitchOptions(state.designOptions?.options || [])
    setChosenId(state.designOptions?.chosenId || '')
    setStitchMessage(state.designOptions?.message || '')
  }, [state.designOptions])
  const [nowTick, setNowTick] = useState(() => Date.now())
  const jira = jiraConnection(state)
  const jiraBrowse = jira?.baseUrl ? jira.baseUrl.replace(/\/$/, '') : ''

  const applyBound = useCallback(
    async (bound: ReturnType<typeof designFromBinding>) => {
      onUpdate({ figmaDesign: bound })
      return bound
    },
    [onUpdate],
  )

  useEffect(() => {
    if (!syncLockUntil) return
    const wait = syncLockUntil - Date.now()
    if (wait <= 0) {
      setSyncLockUntil(0)
      return
    }
    const timer = window.setTimeout(() => setSyncLockUntil(0), wait)
    const tick = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(tick)
    }
  }, [syncLockUntil])

  useEffect(() => {
    if (!state.groomConfirmed || !state.projectId) return
    const missingThumbs = screens.some((screen) => !screen.thumbnailUrl)
    if (hasFigmaFile && screens.length > 0 && !missingThumbs) return
    if (hasFigmaFile && screens.length > 0 && missingThumbs && thumbsTried) return
    let cancelled = false
    fetchFigmaDesign(state.projectId)
      .then(async (result) => {
        if (cancelled || !result.bound || !result.fileKey) return
        await applyBound(designFromBinding(result, state.figmaDesign))
        if (!cancelled) setThumbsTried(true)
      })
      .catch(() => {
        if (!cancelled) setThumbsTried(true)
      })
    return () => {
      cancelled = true
    }
    // Hydrate the bound file, screens, and missing previews when this step opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyBound, hasFigmaFile, screens.length, state.groomConfirmed, state.projectId, thumbsTried])

  const listFigmaFiles = useCallback(async () => {
    if (!state.projectId || !figma?.projectKey) return
    setListingFiles(true)
    setError(null)
    try {
      const list = await fetchFigmaFiles({ projectId: state.projectId, figmaProjectId: figma.projectKey })
      setFigmaFiles(list)
      onUpdate({
        figmaDesign: { ...(state.figmaDesign || {}), availableFiles: list },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not list Figma files.')
    } finally {
      setListingFiles(false)
    }
  }, [figma?.projectKey, onUpdate, state.figmaDesign, state.projectId])

  useEffect(() => {
    if (!showBind || !state.projectId || !figma?.projectKey) return
    let cancelled = false
    setListingFiles(true)
    fetchFigmaFiles({ projectId: state.projectId, figmaProjectId: figma.projectKey })
      .then((list) => {
        if (cancelled) return
        setFigmaFiles(list)
        onUpdate({
          figmaDesign: { ...(state.figmaDesign || {}), availableFiles: list },
        })
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not list Figma files.')
      })
      .finally(() => {
        if (!cancelled) setListingFiles(false)
      })
    return () => {
      cancelled = true
    }
    // List once when the bind panel opens for a Figma project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBind, figma?.projectKey, state.projectId])

  const bindFigma = useCallback(
    async (rawKey?: string, rawUrl?: string, fileName?: string) => {
      const url = (rawUrl || fileUrl).trim()
      const fileKey = rawKey || parseFigmaFileKey(url)
      if (!fileKey && !url) {
        setError('Paste a Figma file URL, or pick a file.')
        return
      }
      const nextUrl = url || (fileKey ? `https://www.figma.com/design/${fileKey}` : '')
      const previous = {
        ...(state.figmaDesign || {}),
        fileKey,
        fileUrl: nextUrl,
        fileName: fileName || state.figmaDesign?.fileName,
        availableFiles: figmaFiles.length ? figmaFiles : state.figmaDesign?.availableFiles,
        syncJira: state.figmaDesign?.syncJira !== false,
      }
      if (!state.projectId) {
        onUpdate({ figmaDesign: previous })
        setShowBind(false)
        return
      }
      setBinding(true)
      setError(null)
      try {
        const result = await ingestFigmaDesign({
          projectId: state.projectId,
          fileKey,
          fileUrl: nextUrl,
          syncJira: previous.syncJira,
          stories: figmaStoryRefs({ ...state, figmaDesign: previous }),
          jiraIssues: figmaJiraRefs(state),
        })
        const bound = designFromBinding(result, previous)
        const next = chosenId
          ? 'This file is bound. Later edits comment on the linked Jira tickets automatically.'
          : ''
        if (next) setStitchMessage(next)
        onUpdate({
          figmaDesign: bound,
          ...(chosenId
            ? {
                designOptions: {
                  ...(state.designOptions || {}),
                  status: 'ready' as const,
                  chosenId,
                  message: next,
                  options: stitchOptions,
                },
              }
            : {}),
        })
        setShowBind(false)
      } catch (err) {
        try {
          const saved = await saveFigmaDesign({
            projectId: state.projectId,
            fileKey,
            fileUrl: nextUrl,
            fileName: previous.fileName,
            syncJira: previous.syncJira,
          })
          const bound = designFromBinding(saved, previous)
          const next = chosenId
            ? 'This file is bound. Later edits comment on the linked Jira tickets automatically.'
            : ''
          if (next) setStitchMessage(next)
          onUpdate({
            figmaDesign: bound,
            ...(chosenId
              ? {
                  designOptions: {
                    ...(state.designOptions || {}),
                    status: 'ready' as const,
                    chosenId,
                    message: next,
                    options: stitchOptions,
                  },
                }
              : {}),
          })
          setShowBind(false)
        } catch {
          setError(figmaActionError(err, 'Could not bind the Figma file.'))
        }
      } finally {
        setBinding(false)
      }
    },
    [chosenId, figmaFiles, fileUrl, onUpdate, state, stitchOptions],
  )

  const openBind = () => {
    if (!figmaConnected) {
      onNavigate?.('integrations')
      return
    }
    setShowBind(true)
    setFileUrl(state.figmaDesign?.fileUrl || '')
  }

  const clearBound = async () => {
    setClearing(true)
    setError(null)
    try {
      if (state.projectId) {
        await clearFigmaDesign(state.projectId)
      }
      onUpdate({ figmaDesign: null })
      setShowBind(false)
      setFileUrl('')
    } catch (err) {
      onUpdate({ figmaDesign: null })
      setError(err instanceof Error ? err.message : 'Could not clear the Figma file.')
    } finally {
      setClearing(false)
    }
  }

  const syncFromFigma = async () => {
    if (!state.projectId || !state.figmaDesign?.fileKey) return
    setSyncing(true)
    setError(null)
    try {
      const stories = figmaStoryRefs(state)
      const jiraIssues = figmaJiraRefs(state)
      const result = await ingestFigmaDesign({
        projectId: state.projectId,
        fileKey: state.figmaDesign.fileKey,
        fileUrl: state.figmaDesign.fileUrl,
        syncJira: state.figmaDesign.syncJira !== false,
        stories,
        jiraIssues,
      })
      const bound = designFromBinding(result, state.figmaDesign)
      const linked = autoLinkFigmaScreens(bound.screens, stories, jiraIssues)
      setSyncLockUntil(0)
      setError(null)
      onUpdate({
        figmaDesign: {
          ...bound,
          screens: linked,
        },
      })
    } catch (err) {
      const message = figmaActionError(err, 'Could not sync the Figma file.')
      setError(message)
      if (isRateLimitCopy(message)) {
        const wait = rateLimitWaitMs(message)
        setSyncLockUntil((prev) => Math.max(prev, Date.now() + wait))
      }
    } finally {
      setSyncing(false)
    }
  }

  const generateDesigns = async () => {
    setGenerating(true)
    setError(null)
    try {
      const result = await proposeStitchDesigns({
        projectName: state.projectName,
        requirementText: state.groomDraft || state.requirementsText,
        stories: (state.productScope?.stories || []).map((story) => ({ title: story.title })),
      })
      const options = (result.options || []).map((option) => ({
        ...option,
        screens: [],
      }))
      setStitchOptions(options)
      setStitchMessage(result.message || '')
      setChosenId('')
      onUpdate({
        designOptions: {
          status: 'ready',
          message: result.message,
          options,
          chosenId: null,
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate designs.')
    } finally {
      setGenerating(false)
    }
  }

  const chooseDesign = (option: DesignOption) => {
    setChosenId(option.id)
    setError(null)
    const message = `You picked ${option.name}. Copy that screen into Figma, then bind the file URL below.`
    setStitchMessage(message)
    if (figmaConnected && !hasFigmaFile) setShowBind(true)
    onUpdate({
      designOptions: {
        ...(state.designOptions || {}),
        status: 'ready',
        chosenId: option.id,
        message,
        options: stitchOptions,
      },
    })
  }

  if (!state.groomConfirmed) return null

  const rawName = design?.fileName?.trim() || ''
  const title =
    rawName && rawName !== design?.fileKey && rawName.toLowerCase() !== 'untitled'
      ? rawName
      : 'Figma file'
  const screenLabel = `${screens.length} screen${screens.length === 1 ? '' : 's'}`
  const linkedCount = screens.filter((screen) => screen.jiraKey).length
  const webhookStatus = (design?.webhookStatus || '').toLowerCase()
  const webhookLocal = webhookStatus.includes('localhost')
  const webhookManual = webhookLocal || !design?.webhookId || webhookStatus.includes('manual')
  const syncLocked = syncLockUntil > nowTick
  const rateLimited = syncLocked
  const lastGoodSummary = isRateLimitCopy(design?.lastSyncSummary) ? null : design?.lastSyncSummary
  const chosenOption = stitchOptions.find((option) => option.id === chosenId)

  return (
    <>
    <section className="card ref-card jira-scope-panel">
      <div className="jira-scope-head">
        <div className="req-section-head">
          <h3>Design options</h3>
          <p>Blink asks Google Stitch for three screens from the groomed requirement. Pick one, copy it into Figma, then bind the file URL.</p>
        </div>
        <button type="button" className="text-btn" disabled={generating} onClick={() => void generateDesigns()}>
          {generating ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          {generating ? 'Generating…' : stitchOptions.length ? 'Generate again' : 'Generate designs'}
        </button>
      </div>
      {stitchOptions.length ? (
        <div className="stitch-options">
          {stitchOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={chosenId === option.id ? 'stitch-option is-chosen' : 'stitch-option'}
              aria-pressed={chosenId === option.id}
              onClick={() => chooseDesign(option)}
            >
              {option.imageUrl ? <img src={designImageSrc(option.imageUrl)} alt="" referrerPolicy="no-referrer" /> : <span className="design-screen-thumb is-empty"><Layers size={16} /></span>}
              <strong>{option.name}</strong>
              <span>{option.summary}</span>
              {chosenId === option.id ? <em className="stitch-picked">Selected</em> : null}
            </button>
          ))}
        </div>
      ) : null}
      {chosenOption ? (
        <div className="stitch-handoff">
          <p>You picked <strong>{chosenOption.name}</strong>.</p>
          <ol>
            <li>
              In <a href="https://stitch.withgoogle.com" target="_blank" rel="noreferrer">Google Stitch</a>, open this screen and choose <strong>Copy to Figma</strong>.
            </li>
            <li>Paste it into a file in your Professional team.</li>
            <li>
              {hasFigmaFile
                ? 'This file is already bound. Use Change Figma file if you pasted the screen into a different file.'
                : figmaConnected
                  ? 'Copy that file’s URL and paste it in Figma file URL below.'
                  : 'Connect Figma, then paste that file’s URL below.'}
            </li>
          </ol>
          <p>
            {hasFigmaFile
              ? 'Later edits in that file comment on the linked Jira tickets automatically.'
              : 'After the bind, later edits in that file comment on the linked Jira tickets automatically.'}
          </p>
        </div>
      ) : stitchMessage ? (
        <p className="field-hint">{stitchMessage}</p>
      ) : null}
    </section>
    <section className="card ref-card jira-scope-panel">
      <div className="jira-scope-head">
        <div className="req-section-head">
          <h3>Figma design</h3>
          <p>
            {hasFigmaFile
              ? 'This project is linked to a Figma file. Open it to edit, change the file, or clear the link.'
              : 'Paste the Figma file URL after you copy the chosen screen into your Professional team.'}
          </p>
        </div>
        {hasFigmaFile ? (
          <div className="jira-scope-head-actions">
            <button
              type="button"
              className="text-btn"
              disabled={syncing || clearing || binding || syncLocked}
              onClick={() => void syncFromFigma()}
            >
              {syncing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
              {syncing ? 'Syncing…' : syncLocked ? 'File read limit reached' : 'Sync from Figma'}
            </button>
            <button type="button" className="text-btn" disabled={clearing || binding || syncing} onClick={() => void clearBound()}>
              {clearing ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
              {clearing ? 'Clearing…' : 'Clear Figma'}
            </button>
          </div>
        ) : null}
      </div>

      {error && !isRateLimitCopy(error) ? <p className="connect-error">{error}</p> : null}

      {hasFigmaFile ? (
        <>
          <div className="jira-scope-metrics">
            <span className="jira-chip story">Linked</span>
            <span className="jira-chip project">{title}</span>
            <span className="jira-chip muted">{screenLabel}</span>
            <span className="jira-chip muted">
              {linkedCount} linked to Jira
            </span>
          </div>
          {lastGoodSummary && !rateLimited ? <p className="field-hint">{lastGoodSummary}</p> : null}
          {(rateLimited || isRateLimitCopy(error)) ? (
            <p className="connect-error">{FIGMA_READ_LIMIT}</p>
          ) : null}
          {rateLimited ? null : webhookStatus.includes('professional') || webhookStatus.includes('starter') ? (
            <p className="field-hint">{design?.webhookStatus}</p>
          ) : webhookLocal ? (
            <p className="field-hint">
              Figma cannot reach this computer, so ticket comments are not automatic. After you edit a linked screen, click Sync from Figma.
            </p>
          ) : webhookManual ? (
            <p className="field-hint">
              After you edit a linked screen, click Sync from Figma. That posts the update on the Jira ticket.
            </p>
          ) : (
            <p className="field-hint">Edits to a linked screen can update its Jira ticket automatically.</p>
          )}
          {screens.length > 0 ? (
            <div className="jira-epic-list">
              {screens.map((screen) => (
                <article key={screen.nodeId} className="jira-epic-card is-linked design-screen-card">
                  <ScreenThumb url={screen.thumbnailUrl} />
                  <div className="design-screen-main">
                    <span className="jira-type story">Screen</span>
                    <strong className="jira-row-title">{screen.name}</strong>
                  </div>
                  <div className="design-screen-meta">
                    {screen.pageName ? <span className="jira-story-count">{screen.pageName}</span> : null}
                    {screen.jiraKey ? (
                      jiraBrowse ? (
                        <a
                          className="jira-ticket-badge"
                          href={`${jiraBrowse}/browse/${screen.jiraKey}`}
                          target="_blank"
                          rel="noreferrer"
                          title={`Open ${screen.jiraKey} in Jira`}
                        >
                          {screen.jiraKey}
                          <ExternalLink size={11} aria-hidden />
                        </a>
                      ) : (
                        <span className="jira-ticket-badge jira-ticket-badge--plain">{screen.jiraKey}</span>
                      )
                    ) : (
                      <span className="design-screen-unlinked">Not linked</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="jira-scope-empty">
              <Layers size={22} />
              <p>
                {binding
                  ? 'Reading screens from Figma…'
                  : 'The file is linked. Blink will list screens here once it can read the Figma frames.'}
              </p>
            </div>
          )}
          {!showBind ? (
            <div className="card-footer-actions">
              <a
                className="secondary-btn"
                href={fileHref(design?.fileKey, design?.fileUrl)}
                target="_blank"
                rel="noreferrer"
              >
                Open Figma
                <ExternalLink size={14} />
              </a>
              <button type="button" className="text-btn" onClick={openBind}>
                Change Figma file
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="card-footer-actions">
          <a className="secondary-btn" href="https://www.figma.com/files" target="_blank" rel="noreferrer">
            Open Figma
            <ExternalLink size={14} />
          </a>
          {!(showBind || (chosenOption && figmaConnected)) ? (
            <button type="button" className="text-btn" onClick={openBind}>
              {figmaConnected ? 'Bind a Figma file' : 'Connect Figma'}
            </button>
          ) : null}
        </div>
      )}

      {(showBind || (chosenOption && !hasFigmaFile)) && figmaConnected ? (
        <div className="design-figma-bind">
          <label htmlFor="design-figma-url">Figma file URL</label>
          <input
            id="design-figma-url"
            type="url"
            value={fileUrl}
            onChange={(e) => setFileUrl(e.target.value)}
            placeholder="https://www.figma.com/design/…"
          />
          {figmaFiles.length > 0 ? (
            <select
              value={design?.fileKey || ''}
              onChange={(e) => {
                const file = figmaFiles.find((item) => item.key === e.target.value)
                setFileUrl(file ? `https://www.figma.com/design/${file.key}` : e.target.value)
                void bindFigma(file?.key, file ? `https://www.figma.com/design/${file.key}` : undefined, file?.name)
              }}
            >
              <option value="">Pick a file from the bound Figma project</option>
              {figmaFiles.map((file) => (
                <option key={file.key} value={file.key}>
                  {file.name}
                </option>
              ))}
            </select>
          ) : figma?.projectKey ? (
            <button type="button" className="text-btn" disabled={listingFiles} onClick={() => void listFigmaFiles()}>
              {listingFiles ? 'Finding files…' : 'Find files in the bound Figma project'}
            </button>
          ) : (
            <p className="field-hint">Paste a file URL. Bind a Figma project on Integrations if you want a file list.</p>
          )}
          <div className="card-footer-actions">
            <button
              type="button"
              className="primary-btn"
              disabled={binding || !fileUrl.trim()}
              onClick={() => void bindFigma()}
            >
              {binding ? (
                <>
                  <Loader2 size={16} className="spin" />
                  Binding…
                </>
              ) : (
                'Bind this file'
              )}
            </button>
            {hasFigmaFile ? (
              <button type="button" className="text-btn" onClick={() => setShowBind(false)}>
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
    </>
  )
}
