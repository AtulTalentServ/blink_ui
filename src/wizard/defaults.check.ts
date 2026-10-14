/**
 * Repo technology merge checks.
 * Run: node --experimental-strip-types src/wizard/defaults.check.ts
 */
import assert from 'node:assert/strict'
import { mergeRecommendedRepoTechnologies, type RepoDefinition, type RepoTechnology } from './defaults.ts'

const mergeRepos: RepoDefinition[] = [
  { id: 'web', name: 'fitoyo-web', purpose: 'frontend', description: '', owner: '', dependencies: '' },
  { id: 'api', name: 'fitoyo-api', purpose: 'backend', description: '', owner: '', dependencies: '' },
]
const mergeCurrent: RepoTechnology[] = [
  {
    repoId: 'web',
    language: 'TypeScript',
    framework: 'React 19 + Vite',
    database: '—',
    buildTool: 'npm / Vite',
    status: 'recommendation',
  },
  {
    repoId: 'api',
    language: 'Java 21',
    framework: 'Spring Boot 3.4',
    database: 'PostgreSQL',
    buildTool: 'Gradle',
    status: 'confirmed',
  },
]
const merged = mergeRecommendedRepoTechnologies(
  mergeCurrent,
  [
    {
      repoId: 'web',
      language: 'TypeScript',
      framework: 'React + Vite',
      database: '—',
      buildTool: 'npm / Vite',
      status: 'recommendation',
    },
    {
      repoId: 'api',
      language: 'Python',
      framework: 'FastAPI',
      database: 'PostgreSQL',
      buildTool: 'pip / uvicorn',
      status: 'recommendation',
    },
  ],
  mergeRepos,
)
assert.equal(merged[0].framework, 'React + Vite')
assert.equal(merged[1].framework, 'Spring Boot 3.4')
assert.equal(merged[1].status, 'confirmed')

const forced = mergeRecommendedRepoTechnologies(
  mergeCurrent,
  [
    {
      repoId: 'web',
      language: 'TypeScript',
      framework: 'React + Vite',
      database: '—',
      buildTool: 'npm / Vite',
      status: 'recommendation',
    },
    {
      repoId: 'api',
      language: 'Python',
      framework: 'FastAPI',
      database: 'PostgreSQL',
      buildTool: 'pip / uvicorn',
      status: 'recommendation',
    },
  ],
  mergeRepos,
  { overwriteConfirmed: true },
)
assert.equal(forced[1].framework, 'FastAPI')
assert.equal(forced[1].status, 'recommendation')

console.log('defaults.check.ts: ok')
