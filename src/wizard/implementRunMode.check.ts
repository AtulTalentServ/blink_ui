import assert from 'node:assert/strict'
import { implementArchitectureContext } from './implementRunMode.ts'

const ctx = implementArchitectureContext({
  projectName: 'Fitoyo',
  topology: 'single-app',
  repositoryModel: 'single-repo',
  architectureStyle: 'layered',
  repositories: [
    { id: 'workspace', name: 'fitoyo-workspace', purpose: 'Workspace', description: '', owner: '', dependencies: '' },
    { id: 'repo-product', name: 'fitoyo', purpose: 'Product', description: 'Coaching app', owner: '', dependencies: '' },
  ],
  repoTechnologies: [
    {
      repoId: 'repo-product',
      language: 'TypeScript',
      framework: 'React',
      database: '—',
      buildTool: 'npm',
      status: 'confirmed',
    },
  ],
  topologyConfirmation: { structure: 'single-repo', confirmedBy: 'lead@example.com', evidenceRef: 'blink:1' },
})

assert.ok(ctx?.markdown.includes('single-app'))
assert.ok(ctx?.markdown.includes('fitoyo'))
assert.ok(ctx?.markdown.includes('React'))
assert.ok(ctx?.summaryLabel.includes('shape'))

console.info('implementRunMode.check.ts ok')
