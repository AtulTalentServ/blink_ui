import { useEffect, useRef, useState } from 'react'
import { CloudUpload, FileText, X } from 'lucide-react'
import type { ScopeOverlayFile, WizardState } from '../wizard/types'
import { extractRequirementText } from '../api/blink'

const REQ_FILE_TYPES = ['.pdf', '.doc', '.docx', '.txt', '.md']
const SOURCE_ZIP_OVERLAY_PATH = '.cursor/context/source-zip-context.md'
const IGNORED_ZIP_SEGMENTS = /(^|\/)(node_modules|\.git|dist|build|\.next|\.venv|__pycache__|target|vendor)\//i
const KEY_MANIFEST_NAMES = new Set([
  'package.json',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'pom.xml',
  'cargo.toml',
  'readme.md',
])

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

async function readZipEntryText(
  bytes: Uint8Array,
  view: DataView,
  localHeaderOffset: number,
  compSize: number,
  method: number,
): Promise<string | null> {
  if (localHeaderOffset + 30 > bytes.length) return null
  if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return null
  const nameLen = view.getUint16(localHeaderOffset + 26, true)
  const extraLen = view.getUint16(localHeaderOffset + 28, true)
  const dataStart = localHeaderOffset + 30 + nameLen + extraLen
  if (dataStart + compSize > bytes.length) return null
  const slice = bytes.subarray(dataStart, dataStart + compSize)
  if (method === 0) {
    return new TextDecoder('utf-8', { fatal: false }).decode(slice)
  }
  if (method === 8 && typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate-raw')
      const writer = ds.writable.getWriter()
      void writer.write(new Uint8Array(slice))
      void writer.close()
      const buf = await new Response(ds.readable).arrayBuffer()
      return new TextDecoder('utf-8', { fatal: false }).decode(buf)
    } catch {
      return null
    }
  }
  return null
}

/**
 * Inspect an uploaded Project ZIP in browser memory (Central Directory + key manifests)
 * so Clarify (`grill-requirement`) receives real repository structure in `{{REPOSITORY_CONTEXT}}`.
 */
async function extractZipRepositoryContext(file: File): Promise<string | null> {
  try {
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const view = new DataView(buffer)
    const minEocdOffset = Math.max(0, bytes.length - 65557)
    let eocdOffset = -1
    for (let i = bytes.length - 22; i >= minEocdOffset; i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i
        break
      }
    }
    if (eocdOffset < 0) return null
    const cdSize = view.getUint32(eocdOffset + 12, true)
    const cdOffset = view.getUint32(eocdOffset + 16, true)
    if (cdOffset + cdSize > bytes.length) return null

    const decoder = new TextDecoder('utf-8', { fatal: false })
    const paths: string[] = []
    const manifests: { path: string; localOffset: number; compSize: number; method: number }[] = []

    let ptr = cdOffset
    const cdEnd = cdOffset + cdSize
    while (ptr + 46 <= cdEnd) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break
      const method = view.getUint16(ptr + 10, true)
      const compSize = view.getUint32(ptr + 20, true)
      const uncompSize = view.getUint32(ptr + 24, true)
      const nameLen = view.getUint16(ptr + 28, true)
      const extraLen = view.getUint16(ptr + 30, true)
      const commentLen = view.getUint16(ptr + 32, true)
      const localOffset = view.getUint32(ptr + 42, true)
      const rawName = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen))
      ptr += 46 + nameLen + extraLen + commentLen

      if (!rawName || rawName.endsWith('/') || IGNORED_ZIP_SEGMENTS.test(rawName)) continue
      paths.push(rawName)
      const baseName = rawName.split('/').pop()?.toLowerCase() || ''
      if (
        KEY_MANIFEST_NAMES.has(baseName) &&
        manifests.length < 4 &&
        uncompSize > 0 &&
        uncompSize <= 32_768
      ) {
        manifests.push({ path: rawName, localOffset, compSize, method })
      }
    }

    if (!paths.length) return null
    const lines: string[] = [
      `# Uploaded Project ZIP: ${file.name}`,
      `Total source files indexed: ${paths.length}`,
      '',
      '## File tree sample',
      ...paths.slice(0, 80).map((p) => `- ${p}`),
    ]
    for (const m of manifests) {
      const content = await readZipEntryText(bytes, view, m.localOffset, m.compSize, m.method)
      if (content?.trim()) {
        lines.push('', `## Manifest (${m.path})`, '```', content.trim().slice(0, 600), '```')
      }
    }
    return lines.join('\n').slice(0, 1180)
  } catch {
    return null
  }
}

function upsertZipOverlay(
  existing: ScopeOverlayFile[] | undefined,
  content: string | null,
): ScopeOverlayFile[] {
  const rest = (existing || []).filter((item) => item.path !== SOURCE_ZIP_OVERLAY_PATH)
  if (!content?.trim()) return rest
  return [...rest, { path: SOURCE_ZIP_OVERLAY_PATH, content }]
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
        <p>Add the source requirement. Clarify it with stakeholders in the next step.</p>
      </div>

      <section className="card ref-card req-capture-card">
          <div className="req-section-head">
            <h3>Requirement</h3>
            <p>Upload a document or paste the text. You will clarify it with stakeholders in the next step.</p>
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
                placeholder="Describe what you are building…"
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

        </section>
    </div>
  )
}

export function validateRequirements(state: WizardState): string | null {
  if (!state.requirementsText.trim() && !state.requirementFileName) {
    return 'Upload a document or paste requirements.'
  }
  return null
}
