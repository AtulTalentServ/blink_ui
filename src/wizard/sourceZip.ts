import type { ScopeOverlayFile } from './types.ts'

export const SOURCE_ZIP_OVERLAY_PATH = '.cursor/context/source-zip-context.md'

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

/** Inspect an uploaded project ZIP in memory so grooming can see repository structure. */
export async function extractZipRepositoryContext(file: File): Promise<string | null> {
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
        KEY_MANIFEST_NAMES.has(baseName)
        && manifests.length < 4
        && uncompSize > 0
        && uncompSize <= 32_768
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
    for (const item of manifests) {
      const content = await readZipEntryText(bytes, view, item.localOffset, item.compSize, item.method)
      if (content?.trim()) {
        lines.push('', `## Manifest (${item.path})`, '```', content.trim().slice(0, 600), '```')
      }
    }
    return lines.join('\n').slice(0, 1180)
  } catch {
    return null
  }
}

export function upsertZipOverlay(
  existing: ScopeOverlayFile[] | undefined,
  content: string | null,
): ScopeOverlayFile[] {
  const rest = (existing || []).filter((item) => item.path !== SOURCE_ZIP_OVERLAY_PATH)
  if (!content?.trim()) return rest
  return [...rest, { path: SOURCE_ZIP_OVERLAY_PATH, content }]
}
