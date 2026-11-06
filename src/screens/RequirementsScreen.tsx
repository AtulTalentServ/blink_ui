import { useEffect, useRef, useState } from 'react'
import { CloudUpload, FileText, X } from 'lucide-react'
import { extractRequirementText } from '../api/blink'
import { isExistingProject } from '../wizard/existing'
import { extractZipRepositoryContext, upsertZipOverlay } from '../wizard/sourceZip'
import type { WizardState } from '../wizard/types'

const REQ_FILE_TYPES = ['.pdf', '.doc', '.docx', '.txt', '.md']

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
}

function isAllowedRequirementFile(name: string) {
  const lower = name.toLowerCase()
  return REQ_FILE_TYPES.some((ext) => lower.endsWith(ext))
}

function clearFile(
  onUpdate: Props['onUpdate'],
  fileInputRef: React.RefObject<HTMLInputElement | null>,
  setLocalText: (val: string) => void,
) {
  setLocalText('')
  onUpdate({ requirementFileName: null, requirementFile: null, requirementsText: '' })
  if (fileInputRef.current) fileInputRef.current.value = ''
}

function sourceMode(gitUrl: string, zipName: string | null): WizardState['existingSourceMode'] {
  if (gitUrl.trim()) return 'git'
  if (zipName) return 'zip'
  return 'none'
}

export function RequirementsScreen({
  state,
  onUpdate,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)
  const extractInFlight = useRef(false)
  const debounceTimerRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [localText, setLocalText] = useState(state.requirementsText)
  const hasUploadedFile = Boolean(state.requirementFileName)
  const hasPaste = Boolean(localText.trim() || state.requirementsText.trim())

  useEffect(() => {
    setLocalText(state.requirementsText)
  }, [state.requirementsText])

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  function handleTextChange(nextValue: string) {
    setLocalText(nextValue)
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null
      onUpdate(
        hasUploadedFile
          ? { requirementsText: nextValue }
          : {
              requirementsText: nextValue,
              requirementFileName: null,
              requirementFile: null,
            },
      )
    }, 250)
  }

  function flushTextChange() {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (localText !== state.requirementsText) {
      onUpdate(
        hasUploadedFile
          ? { requirementsText: localText }
          : {
              requirementsText: localText,
              requirementFileName: null,
              requirementFile: null,
            },
      )
    }
  }

  async function acceptFile(file: File | undefined) {
    if (!file || extractInFlight.current) return
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
      const cleaned = (extracted.text || '').trim()
      if (!cleaned) {
        setFileError('No readable text was found in this file. Paste the requirements below instead.')
        return
      }
      setLocalText(cleaned)
      onUpdate({
        requirementFileName: file.name,
        requirementFile: file,
        requirementsText: cleaned,
      })
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not read this file. Paste the requirements instead.')
    } finally {
      extractInFlight.current = false
      setExtracting(false)
    }
  }

  return (
    <div className="screen screen-ref screen-requirements">
      <div className="screen-header">
        <h2>Requirements</h2>
        <p>
          {isExistingProject(state)
            ? 'Describe this change. GitHub remotes are already bound — do not restate the whole product.'
            : 'Add the source requirement. Clarify it with stakeholders in the next step.'}
        </p>
      </div>

      <section className="card ref-card req-capture-card">
          <div className="req-section-head">
            <h3>Requirement</h3>
            <p>
              {isExistingProject(state)
                ? 'Paste the change, defect, or modernization brief. A starter outline is filled from the bound repositories.'
                : 'Upload a document or paste the text. You will clarify it with stakeholders in the next step.'}
            </p>
          </div>

          {hasUploadedFile ? (
            <div className="req-file-row">
              <FileText size={18} aria-hidden />
              <div className="req-file-meta">
                <strong>{state.requirementFileName}</strong>
                <span>Text extracted. Review it below, then click Continue.</span>
              </div>
              {!extracting && (
                <button
                  type="button"
                  className="ghost-btn req-file-remove"
                  onClick={() => {
                    setFileError(null)
                    clearFile(onUpdate, fileInputRef, setLocalText)
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
              {hasUploadedFile ? <p className="field-hint">Read from the file. Edit anything that looks wrong before continuing.</p> : null}
              <textarea
                id="requirementsText"
                className="req-textarea"
                rows={hasUploadedFile ? 10 : 6}
                placeholder={
                  isExistingProject(state)
                    ? 'Describe the change against the bound application…'
                    : 'Describe what you are building…'
                }
                value={localText}
                onChange={(event) => handleTextChange(event.target.value)}
                onBlur={flushTextChange}
              />
            </div>
          ) : null}

          {hasUploadedFile && !extracting && (
            <button type="button" className="text-btn" onClick={() => {
              setFileError(null)
              clearFile(onUpdate, fileInputRef, setLocalText)
            }}>
              Use pasted text instead
            </button>
          )}

          {isExistingProject(state) ? null : (
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
                            scopeOverlays: upsertZipOverlay(state.scopeOverlays, null),
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
                      const file = event.target.files?.[0]
                      const name = file?.name ?? null
                      onUpdate({
                        sourceZipName: name,
                        existingSourceMode: sourceMode(state.gitRepositoryUrl, name),
                      })
                      if (file) {
                        void extractZipRepositoryContext(file).then((zipContext) => {
                          onUpdate({
                            scopeOverlays: upsertZipOverlay(state.scopeOverlays, zipContext),
                          })
                        })
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          )}

        </section>
    </div>
  )
}

export function validateRequirements(state: WizardState): string | null {
  if (!state.requirementsText.trim() && !state.requirementFileName) {
    return isExistingProject(state)
      ? 'Describe the change to the existing application.'
      : 'Upload a document or paste requirements.'
  }
  return null
}
