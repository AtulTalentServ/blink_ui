import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const pullURL = /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/pull\/(\d+)/i
const here = path.dirname(fileURLToPath(import.meta.url))
const nodeModules = path.join(here, 'node_modules')

export interface LocalPreviewPage {
  title: string
  previewHtml: string
  entryPath: string
  pullRequest: string
}

export interface LocalPreview {
  status: 'ready' | 'unavailable'
  message: string
  previewHtml?: string
  entryPath?: string
  pullRequest?: string
  pages?: LocalPreviewPage[]
}

function git(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 20_000_000,
        timeout: 45_000,
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).trim()))
        else resolve(stdout)
      },
    )
  })
}

async function repoCache(owner: string, repo: string): Promise<string> {
  const dir = path.join(tmpdir(), 'blink-pr-preview', `${owner}__${repo}.git`)
  await mkdir(dir, { recursive: true })
  try {
    await git(['rev-parse', '--is-bare-repository'], dir)
  } catch {
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    await git(['init', '--bare'], dir)
    await git(['remote', 'add', 'origin', `https://github.com/${owner}/${repo}.git`], dir)
  }
  return dir
}

async function tree(cache: string, ref: string): Promise<string[]> {
  const out = await git(['ls-tree', '-r', '--name-only', ref], cache)
  return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

async function fileText(cache: string, ref: string, filePath: string): Promise<string> {
  return git(['show', `${ref}:${filePath}`], cache)
}

function scorePage(filePath: string, text: string): number {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.html')) {
    const sample = text.toLowerCase()
    if (sample.includes('.tsx') || sample.includes('.jsx') || sample.includes('.vue')) return 0
    if (sample.includes('<html') || sample.includes('<!doctype html') || sample.includes('<body')) return 100
    return 0
  }
  if (!lower.endsWith('app.tsx') && !lower.endsWith('app.jsx')) return 0
  let score = 30
  if (/keypad/i.test(text)) score += 20
  if (/evaluateExpression|equals-button|function calculate\b/.test(text)) score += 40
  return score
}

async function archiveTo(cache: string, ref: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const source = spawn('git', ['-C', cache, 'archive', ref], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    const extract = spawn('tar', ['-x', '-C', dest])
    source.stdout.pipe(extract.stdin)
    let err = ''
    source.stderr.on('data', (chunk) => {
      err += String(chunk)
    })
    extract.stderr.on('data', (chunk) => {
      err += String(chunk)
    })
    extract.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(err.trim() || `Could not read the pull request files (${code})`))
    })
    source.on('error', reject)
    extract.on('error', reject)
  })
}

async function bundleApp(
  appDir: string,
  appFile: string,
  screen: { kind: 'default' | 'named'; name: string },
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'blink-pr-bundle-'))
  const entry = path.join(dir, 'entry.tsx')
  const outfile = path.join(dir, 'preview.js')
  const relative = path.relative(dir, path.join(appDir, appFile)).replaceAll('\\', '/')
  const { readFile, writeFile } = await import('node:fs/promises')
  const importLine = screen.kind === 'default'
    ? `import Screen from '${relative}'`
    : `import { ${screen.name} as Screen } from '${relative}'`
  await writeFile(
    entry,
    `import { createRoot } from 'react-dom/client'\n${importLine}\nconst root = document.getElementById('root')\nif (root) createRoot(root).render(<Screen expression="" result={null} entries={[]} sessionEntries={[]} />)\n`,
  )
  try {
    await esbuild.build({
      entryPoints: [entry],
      absWorkingDir: dir,
      outfile,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      jsxImportSource: 'react',
      define: { 'process.env.NODE_ENV': '"development"' },
      nodePaths: [nodeModules],
      loader: { '.css': 'css', '.tsx': 'tsx', '.ts': 'ts', '.jsx': 'jsx' },
    })
    const js = await readFile(outfile, 'utf8')
    let css = ''
    try {
      css = await readFile(path.join(dir, 'preview.css'), 'utf8')
    } catch {
      css = ''
    }
    if (!js) throw new Error('The draft page did not build.')
    return pageHtml(css, js)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const blackTheme = `
:root, html, body, #root { background:#0b0d10; color:#e7e9ee; color-scheme:dark; }
body { margin:0; }
.unmerged-banner { margin:0; padding:8px 12px; background:#1a1408; color:#f6d48a; border-bottom:1px solid #3a2e14; font:600 14px system-ui,sans-serif; }
.calculator-app, .calculator, .history, main, section, form, [class*="calculation"], [class*="history"], [class*="result"] { background:#12161c; color:#e7e9ee; border-color:#2c3442; box-shadow:none; }
label, .expression-label, .expression-help, .empty-history, .history-expression { color:#b7c0ce; }
input, button, .keypad-button { background:#1c2330; color:#e7e9ee; border-color:#3a4558; }
input:focus, button:focus-visible, .keypad-button:focus-visible { outline-color:#60a5fa; }
button:hover, .keypad-button:hover { background:#273143; }
.equals-button { background:#1d4ed8; color:#fff; border-color:#3b82f6; }
.result, .history-result, h1, h2 { color:#f8fafc; }
.error { color:#fca5a5; }
`

function pageHtml(css: string, js: string): string {
  const safeJs = js.replaceAll('</script', '<\\/script')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
${css}
${blackTheme}
</style>
</head>
<body>
<p class="unmerged-banner">Unmerged pull request. Nothing is merged.</p>
<div id="root"></div>
<script>${safeJs}</script>
</body>
</html>`
}

export async function buildLocalPreview(pullRequests: string[]): Promise<LocalPreview> {
  const refs: { url: string; owner: string; repo: string; number: number }[] = []
  const seen = new Set<string>()
  for (const raw of pullRequests) {
    const match = pullURL.exec(raw.trim())
    if (!match) continue
    const key = `${match[1]}/${match[2]}#${match[3]}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ url: raw.trim(), owner: match[1], repo: match[2], number: Number(match[3]) })
  }
  if (refs.length === 0) {
    return { status: 'unavailable', message: 'Run Implement first. Preview opens the application from the draft pull request.' }
  }

  const repos: { owner: string; repo: string }[] = []
  const seenRepos = new Set<string>()
  for (const ref of refs) {
    const key = `${ref.owner}/${ref.repo}`.toLowerCase()
    if (seenRepos.has(key)) continue
    seenRepos.add(key)
    repos.push({ owner: ref.owner, repo: ref.repo })
  }

  type Candidate = {
    owner: string
    repo: string
    cache: string
    gitRef: string
    screen: { file: string; kind: 'default' | 'named' | 'html'; name: string }
    score: number
    source: string
    texts: { file: string; text: string }[]
  }
  const candidates: Candidate[] = []
  let lastError = ''
  for (const repo of repos.slice(0, 4)) {
    try {
      const cache = await repoCache(repo.owner, repo.repo)
      const gitRef = 'refs/preview/implement-all'
      await git(['fetch', '--depth', '1', 'origin', `refs/heads/blink/implement-all:${gitRef}`], cache)
      const files = await tree(cache, gitRef)
      const texts = await Promise.all(files.map(async (file) => ({ file, text: await fileText(cache, gitRef, file).catch(() => '') })))
      const screen = chooseScreen(texts)
      if (!screen) continue
      const source = texts.find((item) => item.file === screen.file)?.text ?? ''
      candidates.push({
        owner: repo.owner,
        repo: repo.repo,
        cache,
        gitRef,
        screen,
        score: scorePage(screen.file, source) + repoBonus(repo.repo),
        source,
        texts,
      })
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Could not read blink/implement-all.'
    }
  }
  candidates.sort((a, b) => b.score - a.score)

  for (const candidate of candidates) {
    const heading = candidate.source.match(/<h1[^>]*>\s*([^<]+)/)?.[1]?.trim()
    const title = heading || candidate.screen.name
    const branchUrl = `https://github.com/${candidate.owner}/${candidate.repo}/tree/blink/implement-all`
    try {
      if (candidate.screen.kind === 'html') {
        if (!candidate.source) continue
        const page = { title, previewHtml: candidate.source, entryPath: candidate.screen.file, pullRequest: branchUrl }
        return readyPage(page)
      }
      const dest = await mkdtemp(path.join(tmpdir(), 'blink-pr-src-'))
      try {
        await archiveTo(candidate.cache, candidate.gitRef, dest)
        const previewHtml = await bundleApp(dest, candidate.screen.file, candidate.screen)
        return readyPage({ title, previewHtml, entryPath: candidate.screen.file, pullRequest: branchUrl })
      } finally {
        await rm(dest, { recursive: true, force: true })
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Could not open the application.'
    }
  }

  return {
    status: 'unavailable',
    message: lastError
      ? `Could not open blink/implement-all. ${lastError}`
      : 'blink/implement-all has no screen to open.',
  }
}

function readyPage(page: LocalPreviewPage): LocalPreview {
  return {
    status: 'ready',
    message: 'This is the draft application. Nothing is merged.',
    previewHtml: page.previewHtml,
    entryPath: page.entryPath,
    pullRequest: page.pullRequest,
    pages: [page],
  }
}

function repoBonus(repo: string): number {
  const name = repo.toLowerCase()
  if (name.includes('frontend') || name.includes('web') || name.includes('-ui')) return 15
  if (name.includes('backend') || name.includes('server') || name.includes('-api')) return -15
  return 0
}

function chooseScreen(files: { file: string; text: string }[]): { file: string; kind: 'default' | 'named' | 'html'; name: string } | null {
  const html = files.find((item) => {
    const lower = item.file.toLowerCase()
    return lower.endsWith('.html') && scorePage(item.file, item.text) > 0
  })
  if (html) return { file: html.file, kind: 'html', name: path.basename(html.file, '.html') }
  const tsx = files.filter((item) => /\.tsx$/i.test(item.file) && !/\.(test|spec)\.tsx$/i.test(item.file))
  const apps = tsx.filter((item) => /(?:^|\/)app\.tsx$/i.test(item.file))
  const app = apps.sort((a, b) => scorePage(b.file, b.text) - scorePage(a.file, a.text))[0]
  const chosen = app ?? tsx.find((item) => /export\s+(?:default\s+)?function\s+[A-Z]/.test(item.text))
  if (!chosen) return null
  const named = chosen.text.match(/export\s+function\s+([A-Z]\w*)/)
  if (/export\s+default\b/.test(chosen.text)) {
    const defName = chosen.text.match(/export\s+default\s+function\s+([A-Z]\w*)/)
    return { file: chosen.file, kind: 'default', name: defName?.[1] || 'App' }
  }
  if (!named) return null
  return { file: chosen.file, kind: 'named', name: named[1] }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function localPrPreviewPlugin(): Plugin {
  return {
    name: 'local-pr-preview',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url !== '/local-pr-preview' || req.method !== 'POST') {
          next()
          return
        }
        void servePreview(req, res)
      })
    },
  }
}

async function servePreview(req: IncomingMessage, res: ServerResponse) {
  try {
    const raw = await readBody(req)
    const body = raw ? (JSON.parse(raw) as { pullRequests?: unknown }) : {}
    const pullRequests = Array.isArray(body.pullRequests) ? body.pullRequests.map(String) : []
    const result = await buildLocalPreview(pullRequests)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'unavailable',
      message: err instanceof Error ? err.message : 'Could not open the draft on this machine.',
    }))
  }
}
