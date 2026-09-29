import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, CloudUpload, FileText, X } from 'lucide-react'
import type { WizardState, WizardStep } from '../wizard/types'
import { GroomingPanel } from './GroomRequirementScreen'
import { JiraScopePanel } from './JiraScopePanel'
import { DesignOptionsPanel } from './DesignOptionsPanel'
import { ScopeStartStatus, validateSdlcScope } from './SdlcPlanningScreen'
import { RequirementRevisionPanel } from './RequirementRevisionPanel'
import { extractRequirementText } from '../api/blink'
import { unansweredRequired } from '../wizard/grooming'
import { shouldAutoStartClarify } from '../wizard/thinking'
import type { JiraPublishState } from '../wizard/thinking'

type ReqStage = 'capture' | 'clarify' | 'tickets'

const REQ_FILE_TYPES = ['.pdf', '.doc', '.docx', '.txt', '.md']

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  grooming?: boolean
  jiraPublish?: JiraPublishState | null
  onAsk?: () => void
  onPick?: (questionId: string, optionId: string, optionLabel: string) => void
  onOther?: (questionId: string, text: string) => void
  onToggleOther?: (questionId: string, checked: boolean) => void
  onUseWording?: () => void
  onStartOver?: () => void
  onNavigate?: (step: WizardStep) => void
}

function isAllowedRequirementFile(name: string) {
  const lower = name.toLowerCase()
  return REQ_FILE_TYPES.some((ext) => lower.endsWith(ext))
}

function clearFile(onUpdate: Props['onUpdate'], fileInputRef: React.RefObject<HTMLInputElement | null>) {
  onUpdate({ requirementFileName: null, requirementFile: null, requirementsText: '' })
  if (fileInputRef.current) fileInputRef.current.value = ''
}

function deriveStage(state: WizardState): ReqStage {
  if (state.groomConfirmed) return 'tickets'
  if (
    state.groomQuestions.length > 0 ||
    state.groomStatus === 'draft_ready' ||
    state.groomStatus === 'need_choices' ||
    state.groomStatus === 'error'
  ) {
    return 'clarify'
  }
  return 'capture'
}

function sourceMode(gitUrl: string, zipName: string | null): WizardState['existingSourceMode'] {
  if (gitUrl.trim()) return 'git'
  if (zipName) return 'zip'
  return 'none'
}

export function RequirementsScreen({
  state,
  onUpdate,
  grooming,
  jiraPublish,
  onAsk,
  onPick,
  onOther,
  onToggleOther,
  onUseWording,
  onStartOver,
  onNavigate,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)
  const extractInFlight = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [wordingOpen, setWordingOpen] = useState(false)
  const hasUploadedFile = Boolean(state.requirementFileName)
  const hasPaste = Boolean(state.requirementsText.trim())
  const pasteLocked =
    !state.groomConfirmed &&
    (state.groomQuestions.length > 0 || state.groomStatus === 'draft_ready' || state.groomStatus === 'need_choices')

  const autoStage = useMemo(() => deriveStage(state), [state])
  const [stage, setStage] = useState<ReqStage>(autoStage)

  useEffect(() => {
    setStage(autoStage)
  }, [autoStage])

  useEffect(() => {
    if (stage !== 'clarify') return
    if (!onAsk || grooming) return
    if (
      !shouldAutoStartClarify({
        hasPaste,
        questionCount: state.groomQuestions.length,
        groomStatus: state.groomStatus,
      })
    ) {
      return
    }
    onAsk()
  }, [stage, hasPaste, grooming, onAsk, state.groomQuestions.length, state.groomStatus])

  async function acceptFile(file: File | undefined) {
    if (!file || extractInFlight.current || pasteLocked) return
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!isAllowedRequirementFile(file.name)) {
      setFileError('Use a PDF, Word, TXT, or Markdown file.')
      return
    }
    extractInFlight.current = true
    setFileError(null)
    setExtracting(true)
    try {
      const extracted = await extractRequirementText(file)
      onUpdate({
        requirementFileName: file.name,
        requirementFile: file,
        requirementsText: extracted.text,
      })
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not read this file. Paste the requirements instead.')
    } finally {
      extractInFlight.current = false
      setExtracting(false)
    }
  }

  const stages: { id: ReqStage; label: string; enabled: boolean; done: boolean }[] = [
    { id: 'capture', label: 'Capture', enabled: true, done: hasPaste || hasUploadedFile },
    {
      id: 'clarify',
      label: 'Clarify',
      enabled: hasPaste || state.groomQuestions.length > 0,
      done: state.groomConfirmed,
    },
    {
      id: 'tickets',
      label: 'Tickets',
      enabled: state.groomConfirmed || Boolean(state.requirementFileName && !hasPaste),
      done: Boolean(state.jiraCreatedIssues?.some((item) => item.status === 'created')),
    },
  ]

  function goToClarify() {
    setStage('clarify')
    if (
      shouldAutoStartClarify({
        hasPaste,
        questionCount: state.groomQuestions.length,
        groomStatus: state.groomStatus,
      })
    ) {
      onAsk?.()
    }
  }

  const canGroom =
    hasPaste && onAsk && onPick && onOther && onToggleOther && onUseWording && onStartOver
  const jiraConnected = Boolean(state.integrations.find((item) => item.id === 'jira')?.connected)
  const confirmedText = state.groomDraft || state.requirementsText

  return (
    <div className="screen screen-ref screen-requirements">
      <div className="screen-header">
        <h2>Requirements</h2>
        <p>Add the requirement, clarify gaps, then create Jira tickets.</p>
      </div>

      <ol className="req-stepper" aria-label="Requirements steps">
        {stages.map((item, index) => {
          const active = stage === item.id
          return (
            <li key={item.id} className={active ? 'is-active' : item.done ? 'is-done' : ''}>
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                disabled={!item.enabled}
                onClick={() => item.enabled && setStage(item.id)}
              >
                <span className="req-step-index" aria-hidden="true">
                  {item.done && !active ? <Check size={12} strokeWidth={2.5} /> : index + 1}
                </span>
                <span className="req-step-label">{item.label}</span>
              </button>
            </li>
          )
        })}
      </ol>

      {stage === 'capture' && (
        <section className="card ref-card req-capture-card">
          <div className="req-section-head">
            <h3>Requirement</h3>
            <p>Upload a document or paste the text. A document is read into text, then clarified like a paste.</p>
          </div>

          {hasUploadedFile ? (
            <div className="req-file-row">
              <FileText size={18} aria-hidden />
              <div className="req-file-meta">
                <strong>{state.requirementFileName}</strong>
                <span>Text extracted. Review it below, then continue to clarify.</span>
              </div>
              {!pasteLocked && (
                <button
                  type="button"
                  className="ghost-btn req-file-remove"
                  onClick={() => {
                    setFileError(null)
                    clearFile(onUpdate, fileInputRef)
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ) : (
            <div
              role="button"
              tabIndex={extracting ? -1 : 0}
              aria-disabled={extracting}
              aria-busy={extracting}
              className={`req-dropzone${dragging ? ' is-dragging' : ''}${extracting ? ' is-reading' : ''}`}
              onClick={() => {
                if (!extracting) fileInputRef.current?.click()
              }}
              onKeyDown={(event) => {
                if (extracting) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              onDragEnter={(event) => {
                event.preventDefault()
                if (!extracting) setDragging(true)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
                if (!extracting) setDragging(true)
              }}
              onDragLeave={(event) => {
                const next = event.relatedTarget
                if (next instanceof Node && event.currentTarget.contains(next)) return
                setDragging(false)
              }}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                void acceptFile(event.dataTransfer.files[0])
              }}
            >
              <CloudUpload size={28} strokeWidth={1.6} />
              <span className="dropzone-title">
                {extracting ? 'Reading the document…' : 'Drop a requirement file here'}
              </span>
              <span className="dropzone-sub">PDF, Word, TXT, or Markdown — or click to browse</span>
            </div>
          )}
          {fileError ? (
            <p className="field-hint req-file-error" role="alert">
              {fileError}
            </p>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept={REQ_FILE_TYPES.join(',')}
            hidden
            onChange={(event) => void acceptFile(event.target.files?.[0])}
          />

          {!hasUploadedFile || hasPaste ? (
            <div className="field-group">
              <label htmlFor="requirementsText">
                {hasUploadedFile ? 'Requirement text' : 'Paste requirements'}
              </label>
              {hasUploadedFile && !pasteLocked ? (
                <p className="field-hint">Read from the file. Edit anything that looks wrong before clarifying.</p>
              ) : null}
              {pasteLocked ? (
                <p className="field-hint">
                  Text is locked while you answer questions. Start over on Clarify if you need to change it.
                </p>
              ) : null}
              <textarea
                id="requirementsText"
                className={`req-textarea${pasteLocked ? ' locked' : ''}`}
                rows={hasUploadedFile ? 10 : 6}
                placeholder="Describe what you are building…"
                value={state.requirementsText}
                readOnly={pasteLocked}
                onChange={(event) =>
                  onUpdate(
                    hasUploadedFile
                      ? { requirementsText: event.target.value }
                      : {
                          requirementsText: event.target.value,
                          requirementFileName: null,
                          requirementFile: null,
                        },
                  )
                }
              />
            </div>
          ) : null}

          {hasUploadedFile && !pasteLocked && (
            <button type="button" className="text-btn" onClick={() => {
              setFileError(null)
              clearFile(onUpdate, fileInputRef)
            }}>
              Use pasted text instead
            </button>
          )}

          <div className="req-existing">
            <div className="req-section-head">
              <h3>
                Existing application <span className="optional-tag">Optional</span>
              </h3>
              <p>Add a Git URL or a project ZIP if this work is for an app you already have.</p>
            </div>
            <div className="req-existing-grid">
              <div className="field-group">
                <label htmlFor="gitRepositoryUrl">Git repository</label>
                <input
                  id="gitRepositoryUrl"
                  className="full-input"
                  placeholder="https://github.com/org/repo"
                  value={state.gitRepositoryUrl}
                  onChange={(event) =>
                    onUpdate({
                      gitRepositoryUrl: event.target.value,
                      existingSourceMode: sourceMode(event.target.value, state.sourceZipName),
                    })
                  }
                />
              </div>
              <div className="field-group">
                <label htmlFor="sourceZip">Project ZIP</label>
                <div className="req-zip-row">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => zipInputRef.current?.click()}
                  >
                    {state.sourceZipName ? 'Replace ZIP' : 'Choose ZIP'}
                  </button>
                  {state.sourceZipName ? (
                    <span className="req-file-chip">
                      {state.sourceZipName}
                      <button
                        type="button"
                        className="req-file-chip-clear"
                        aria-label="Remove ZIP"
                        onClick={() => {
                          if (zipInputRef.current) zipInputRef.current.value = ''
                          onUpdate({
                            sourceZipName: null,
                            existingSourceMode: sourceMode(state.gitRepositoryUrl, null),
                          })
                        }}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ) : null}
                  <input
                    id="sourceZip"
                    ref={zipInputRef}
                    type="file"
                    accept=".zip"
                    hidden
                    onChange={(event) => {
                      const name = event.target.files?.[0]?.name ?? null
                      onUpdate({
                        sourceZipName: name,
                        existingSourceMode: sourceMode(state.gitRepositoryUrl, name),
                      })
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {(hasPaste || hasUploadedFile) && (
            <div className="card-footer-actions right">
              {hasUploadedFile && !hasPaste ? (
                <button type="button" className="primary-btn" onClick={() => setStage('tickets')}>
                  Continue to tickets
                </button>
              ) : (
                <button type="button" className="primary-btn" onClick={goToClarify} disabled={!hasPaste}>
                  Continue to clarify
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {stage === 'clarify' && canGroom && (
        <section className="card ref-card req-clarify-card">
          <GroomingPanel
            state={state}
            loading={Boolean(grooming)}
            onPick={onPick}
            onOther={onOther}
            onToggleOther={onToggleOther}
            onUseWording={onUseWording}
            onStartOver={onStartOver}
            onUpdate={onUpdate}
            onNavigate={onNavigate}
            showJiraPanel={false}
          />
        </section>
      )}

      {stage === 'clarify' && !canGroom && (
        <section className="card ref-card">
          <div className="empty-state-block">
            <h3>No requirement text yet</h3>
            <p>Paste a description on Capture first. Blink uses that text to ask clarifying questions.</p>
            <button type="button" className="secondary-btn" onClick={() => setStage('capture')}>
              Back to Capture
            </button>
          </div>
        </section>
      )}

      {stage === 'tickets' && (
        <div className="req-tickets">
          {state.groomConfirmed || state.requirementFileName ? (
            <>
              {confirmedText ? (
                <section className={`card ref-card req-wording-card${wordingOpen ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="groom-band-header"
                    aria-expanded={wordingOpen}
                    onClick={() => setWordingOpen((open) => !open)}
                  >
                    <div className="req-section-head">
                      <h3>Confirmed wording</h3>
                      <p>{wordingOpen ? 'Click to hide the saved requirement' : 'Click to view the saved requirement'}</p>
                    </div>
                    <span className="groom-band-meta">
                      {wordingOpen ? 'Hide' : 'Show'}
                      <span className="groom-band-chevron" aria-hidden>
                        <ChevronDown size={16} className={wordingOpen ? 'chevron open' : 'chevron'} />
                      </span>
                    </span>
                  </button>
                  {wordingOpen ? <pre className="groom-draft">{confirmedText}</pre> : null}
                </section>
              ) : (
                <section className="card ref-card req-wording-card">
                  <div className="req-section-head">
                    <h3>Uploaded document</h3>
                    <p>{state.requirementFileName} will be used as the requirement source.</p>
                  </div>
                </section>
              )}
              <DesignOptionsPanel state={state} onUpdate={onUpdate} onNavigate={onNavigate} />
              <JiraScopePanel
                state={state}
                onUpdate={onUpdate}
                sourceText={confirmedText}
                jiraPublish={jiraPublish}
              />
              <ScopeStartStatus state={state} onUpdate={onUpdate} />
              <RequirementRevisionPanel projectId={state.projectId} />
              {!jiraConnected && onNavigate ? (
                <p className="groom-blocker-hint">
                  Connect Atlassian to create tickets.{' '}
                  <button type="button" className="text-btn" onClick={() => onNavigate('integrations')}>
                    Open Integrations
                  </button>
                </p>
              ) : null}
            </>
          ) : (
            <section className="card ref-card">
              <div className="empty-state-block">
                <h3>Finish clarifying first</h3>
                <p>Answer the required questions, then use the cleared wording so tickets can be planned.</p>
                <button type="button" className="secondary-btn" onClick={() => setStage('clarify')}>
                  Go to Clarify
                </button>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

export function validateRequirements(state: WizardState): string | null {
  if (!state.requirementsText.trim() && !state.requirementFileName) {
    return 'Upload a document or paste requirements.'
  }
  if (!state.requirementsText.trim() && state.requirementFileName) {
    return null
  }
  if (!state.groomConfirmed) {
    if (!state.groomQuestions.length && state.groomStatus !== 'draft_ready' && state.groomStatus !== 'error') {
      return 'Continue to Clarify so Blink can start the questions, then answer the required ones.'
    }
    const missing = unansweredRequired(state)
    if (missing.length) {
      return `Answer or mark Jira later on the ${missing.length} required question${missing.length === 1 ? '' : 's'} under Need clarification.`
    }
    return 'Click Use this wording so Blink can rewrite from your answers.'
  }
  return validateSdlcScope(state)
}
