export interface RepoDefinition {
  id: string
  name: string
  purpose: string
  description: string
  owner: string
  dependencies: string
  htmlUrl?: string
  createStatus?: 'created' | 'exists' | 'failed'
  createMessage?: string
}

export interface WorkspaceEntry {
  name: string
  kind: 'file' | 'directory'
}

export function workspaceRootName(projectName: string): string {
  const slug = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  const base = slug || 'project'
  return base.endsWith('_workspace') ? base : `${base}_workspace`
}

const SHARED_DOWNLOAD_FOLDERS = ['.cursor', 'automation_sdlc'] as const

export const EXCLUDED_DOWNLOAD_FOLDERS = ['blink_demo', 'blink_backend', 'blink-backend'] as const

export function isExcludedDownloadFolder(name: string): boolean {
  const normalized = name.trim().replace(/\\/g, '/').split('/').filter(Boolean)
  return normalized.some((part) => (EXCLUDED_DOWNLOAD_FOLDERS as readonly string[]).includes(part))
}

export function sanitizeDownloadStructure(entries: WorkspaceEntry[] = []): WorkspaceEntry[] {
  return entries.filter((entry) => !isExcludedDownloadFolder(entry.name))
}

export function buildDownloadStructure(repositories: { name: string }[] = []): WorkspaceEntry[] {
  const reserved = new Set<string>([
    'requirement.md',
    ...SHARED_DOWNLOAD_FOLDERS,
    ...EXCLUDED_DOWNLOAD_FOLDERS,
  ])
  const repos = repositories
    .map((repo) => githubRepoSlug(repo.name))
    .filter((name) => name && !reserved.has(name))
    .filter((name, index, all) => all.indexOf(name) === index)
    .map((name) => ({ name, kind: 'directory' as const }))
  return sanitizeDownloadStructure([
    { name: 'requirement.md', kind: 'file' },
    { name: 'automation_sdlc', kind: 'directory' },
    { name: '.cursor', kind: 'directory' },
    ...repos,
  ])
}

export const NEXT_SDLC_COMMAND = '/configure-stakeholders'

export interface RepoTechnology {
  repoId: string
  language: string
  framework: string
  database: string
  buildTool: string
  status: 'confirmed' | 'recommendation' | 'tbd'
}

export interface IntegrationItem {
  id: string
  label: string
  category: string
  icon: string
  connected: boolean
  account?: string
  detail?: string
  baseUrl?: string
  organization?: string
  workspace?: string
  email?: string
  username?: string
  projectKey?: string
  projectName?: string
  cloudId?: string
  authType?: 'oauth' | 'token'
  spaceKey?: string
  token?: string
  availableProjects?: {
    id: string
    key: string
    name: string
    projectTypeKey?: string
    avatarUrl?: string
  }[]
  availableOrganizations?: {
    login: string
    name: string
    avatarUrl?: string
    personal?: boolean
  }[]
}

export const TOPOLOGY_OPTIONS = [
  { id: 'single-app', label: 'Single App', icon: '📱', hint: 'One deployable product surface' },
  { id: 'frontend-only', label: 'Frontend Only', icon: '🖥️', hint: 'UI against existing APIs' },
  { id: 'full-stack', label: 'Full Stack', icon: '⚡', hint: 'UI + API together' },
  { id: 'data-platform', label: 'Data Platform', icon: '📊', hint: 'Pipelines, warehouse, jobs' },
  { id: 'microservices', label: 'Microservices', icon: '🔗', hint: 'Multiple independently deployable services' },
  { id: 'ai-ml', label: 'AI / ML', icon: '🤖', hint: 'Model serving and training paths' },
]

export const REPO_MODEL_OPTIONS = [
  { id: 'single-repo', label: 'Single Repo', hint: 'One Git repo for the product' },
  { id: 'monorepo', label: 'Monorepo', hint: 'One repo with multiple packages/apps' },
  { id: 'multi-repo', label: 'Multi-Repo', hint: 'Separate Git repos per component' },
]

export const ARCHITECTURE_OPTIONS = [
  { id: 'layered', label: 'Layered', hint: 'Presentation → domain → data' },
  { id: 'microservices', label: 'Microservices', hint: 'Service boundaries and APIs' },
  { id: 'modular-monolith', label: 'Modular Monolith', hint: 'Modules in one deployable' },
  { id: 'event-driven', label: 'Event Driven', hint: 'Async events between components' },
]

export const IDE_TOOL_OPTIONS = [
  {
    id: 'cursor',
    label: 'Cursor',
    description: 'AI-native IDE with agent and slash commands',
    enabled: true,
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Anthropic CLI coding agent in the terminal',
    enabled: false,
  },
  {
    id: 'vscode-claude',
    label: 'VS Code + Claude',
    description: 'Visual Studio Code with the Claude extension',
    enabled: false,
  },
  {
    id: 'vscode-copilot',
    label: 'VS Code + Copilot',
    description: 'Visual Studio Code with GitHub Copilot',
    enabled: false,
  },
]

export function ideOverlayPath(ideTool: string): string {
  switch (ideTool) {
    case 'claude-code':
      return '.claude/'
    case 'vscode-claude':
    case 'vscode-copilot':
      return '.vscode/'
    default:
      return '.cursor/ai-sdlc/'
  }
}

export const DEFAULT_INTEGRATIONS: IntegrationItem[] = [
  { id: 'github', label: 'GitHub', category: 'Code management', icon: '🐙', connected: false },
  { id: 'jira', label: 'Jira', category: 'Issue Tracker', icon: '📋', connected: false },
  { id: 'confluence', label: 'Confluence', category: 'Documentation', icon: '📘', connected: false },
  { id: 'figma', label: 'Figma', category: 'Design', icon: '🎨', connected: false },
  { id: 'bitbucket', label: 'Bitbucket', category: 'Git Provider', icon: '🪣', connected: false },
]

export interface RequirementComponent {
  id: string
  purpose: string
  description: string
}

/** Turn requirement surfaces into repository rows for the chosen model. */
export function repositoriesFromComponents(
  projectName: string,
  repositoryModel: string,
  components: RequirementComponent[],
): RepoDefinition[] {
  const slug = githubRepoSlug(projectName)
  const parts = components.filter((item) => item.id.trim() && item.purpose.trim())
  if (!parts.length) return []
  const workspace: RepoDefinition = {
    id: 'workspace',
    name: `${slug}-workspace`,
    purpose: 'Workspace',
    description: 'SDLC workspace for this product',
    owner: '',
    dependencies: '',
  }
  if (repositoryModel === 'single-repo') {
    return [
      workspace,
      {
        id: 'repo-product',
        name: slug,
        purpose: 'Product',
        description: parts.map((item) => item.purpose).join(', '),
        owner: '',
        dependencies: '',
      },
    ]
  }
  if (repositoryModel === 'monorepo' || repositoryModel === 'mono-repo') {
    return [
      workspace,
      {
        id: 'repo-monorepo',
        name: `${slug}-monorepo`,
        purpose: 'Monorepo',
        description: `Packages: ${parts.map((item) => item.id).join(', ')}`,
        owner: '',
        dependencies: '',
      },
    ]
  }
  return [
    workspace,
    ...parts.map((item) => ({
      id: item.id,
      name: `${slug}-${item.id}`,
      purpose: item.purpose,
      description: item.description,
      owner: '',
      dependencies: '',
    })),
  ]
}

export function githubRepoSlug(projectName: string): string {
  const slug = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'project'
}

type RepoVariant = {
  id: string
  suffix: string
  purpose: string
  description: string
}

const VARIANT = {
  workspace: {
    id: 'repo-workspace',
    suffix: 'workspace',
    purpose: 'Workspace',
    description: 'AI-SDLC overlay and planning artifacts',
  },
  app: {
    id: 'repo-app',
    suffix: 'app',
    purpose: 'Application',
    description: 'Primary product application',
  },
  backend: {
    id: 'repo-backend',
    suffix: 'backend',
    purpose: 'Backend',
    description: 'Application API and business services',
  },
  frontend: {
    id: 'repo-frontend',
    suffix: 'frontend',
    purpose: 'Frontend',
    description: 'Web UI',
  },
  db: {
    id: 'repo-db',
    suffix: 'db',
    purpose: 'Database',
    description: 'Schema, migrations, and data scripts',
  },
  infra: {
    id: 'repo-infra',
    suffix: 'infra',
    purpose: 'Infrastructure',
    description: 'Provisioning, environments, and delivery',
  },
  data: {
    id: 'repo-data',
    suffix: 'data',
    purpose: 'Data',
    description: 'Pipelines, warehouse jobs, and analytics',
  },
  ml: {
    id: 'repo-ml',
    suffix: 'ml',
    purpose: 'ML',
    description: 'Training, evaluation, and model packaging',
  },
  workers: {
    id: 'repo-workers',
    suffix: 'workers',
    purpose: 'Workers',
    description: 'Async jobs and event consumers',
  },
} as const satisfies Record<string, RepoVariant>

export interface ProjectShapeInput {
  topology?: string
  repositoryModel?: string
  architectureStyle?: string
}

function topologyVariants(topology: string): RepoVariant[] {
  switch (topology) {
    case 'single-app':
      return [VARIANT.workspace, VARIANT.app]
    case 'frontend-only':
      return [VARIANT.workspace, VARIANT.frontend]
    case 'full-stack':
      return [VARIANT.workspace, VARIANT.backend, VARIANT.frontend, VARIANT.db]
    case 'data-platform':
      return [VARIANT.workspace, VARIANT.data, VARIANT.backend, VARIANT.infra]
    case 'ai-ml':
      return [VARIANT.workspace, VARIANT.backend, VARIANT.ml, VARIANT.frontend, VARIANT.infra]
    case 'microservices':
    default:
      return [VARIANT.workspace, VARIANT.backend, VARIANT.frontend, VARIANT.db, VARIANT.infra]
  }
}

function applyArchitecture(variants: RepoVariant[], architectureStyle: string): RepoVariant[] {
  if (architectureStyle === 'event-driven' && !variants.some((v) => v.id === VARIANT.workers.id)) {
    return [...variants, VARIANT.workers]
  }
  if (architectureStyle === 'modular-monolith') {
    const kept = variants.filter((v) => v.id !== VARIANT.infra.id && v.id !== VARIANT.db.id)
    const hasAppSurface = kept.some((v) =>
      v.purpose === 'Backend' || v.purpose === 'Application' || v.purpose === 'Frontend',
    )
    return hasAppSurface ? kept : [...kept, VARIANT.app]
  }
  return variants
}

function applyRepoModel(variants: RepoVariant[], repositoryModel: string, slug: string): RepoDefinition[] {
  const workspace = variants.find((v) => v.id === VARIANT.workspace.id) || VARIANT.workspace
  const others = variants.filter((v) => v.id !== VARIANT.workspace.id)

  if (repositoryModel === 'single-repo') {
    return [
      {
        id: workspace.id,
        name: `${slug}-workspace`,
        purpose: workspace.purpose,
        description: workspace.description,
        owner: '',
        dependencies: '',
      },
      {
        id: 'repo-product',
        name: slug,
        purpose: 'Product',
        description: `Single repo for ${others.map((o) => o.purpose.toLowerCase()).join(', ') || 'the product'}`,
        owner: '',
        dependencies: '',
      },
    ]
  }

  if (repositoryModel === 'monorepo') {
    return [
      {
        id: workspace.id,
        name: `${slug}-workspace`,
        purpose: workspace.purpose,
        description: workspace.description,
        owner: '',
        dependencies: '',
      },
      {
        id: 'repo-monorepo',
        name: `${slug}-monorepo`,
        purpose: 'Monorepo',
        description: `Packages: ${others.map((o) => o.suffix).join(', ') || 'app'}`,
        owner: '',
        dependencies: '',
      },
    ]
  }

  return variants.map((variant) => ({
    id: variant.id,
    name: `${slug}-${variant.suffix}`,
    purpose: variant.purpose,
    description: variant.description,
    owner: '',
    dependencies: '',
  }))
}

/** Suggested repos from project name + Project Shape choices. */
export function defaultRepositories(
  projectName: string,
  shape: ProjectShapeInput = {},
): RepoDefinition[] {
  const slug = githubRepoSlug(projectName)
  const topology = shape.topology || 'full-stack'
  const repositoryModel = shape.repositoryModel || 'multi-repo'
  const architectureStyle = shape.architectureStyle || 'layered'
  const variants = applyArchitecture(topologyVariants(topology), architectureStyle)
  return applyRepoModel(variants, repositoryModel, slug)
}

export function defaultRepoTechnologies(
  repos: RepoDefinition[],
  shape: ProjectShapeInput = {},
): RepoTechnology[] {
  const topology = shape.topology || ''
  return repos.map((repo) => {
    const name = repo.name.toLowerCase()
    const purpose = repo.purpose.toLowerCase()
    if (purpose === 'workspace' || name.endsWith('-workspace') || name.includes('workspace')) {
      return {
        repoId: repo.id,
        language: 'Markdown / YAML',
        framework: 'AI-SDLC workspace',
        database: '—',
        buildTool: '—',
        status: 'confirmed' as const,
      }
    }
    if (purpose === 'web' || purpose === 'frontend' || name.endsWith('-frontend') || name.endsWith('-web') || name.includes('web')) {
      return {
        repoId: repo.id,
        language: 'TypeScript',
        framework: 'React 19 + Vite',
        database: '—',
        buildTool: 'npm / Vite',
        status: 'recommendation' as const,
      }
    }
    if (
      purpose === 'api'
      || purpose === 'backend'
      || name.endsWith('-api')
      || name.endsWith('-backend')
    ) {
      return {
        repoId: repo.id,
        language: 'Java 21',
        framework: 'Spring Boot 3.4',
        database: 'PostgreSQL',
        buildTool: 'Gradle',
        status: 'recommendation' as const,
      }
    }
    if (purpose === 'mobile' || name.endsWith('-mobile')) {
      return {
        repoId: repo.id,
        language: 'TypeScript',
        framework: 'React Native',
        database: '—',
        buildTool: 'npm',
        status: 'recommendation' as const,
      }
    }
    if (purpose === 'admin' || name.endsWith('-admin')) {
      return {
        repoId: repo.id,
        language: 'TypeScript',
        framework: 'React 19 + Vite',
        database: '—',
        buildTool: 'npm / Vite',
        status: 'recommendation' as const,
      }
    }
    if (purpose === 'database' || name.endsWith('-db') || purpose === 'data') {
      return {
        repoId: repo.id,
        language: purpose === 'data' ? 'Python / SQL' : 'SQL',
        framework: purpose === 'data' ? 'dbt / Spark jobs' : 'PostgreSQL',
        database: 'PostgreSQL',
        buildTool: purpose === 'data' ? 'Airflow / dbt' : 'Flyway / Liquibase',
        status: 'recommendation' as const,
      }
    }
    if (purpose === 'infrastructure' || name.endsWith('-infra')) {
      return {
        repoId: repo.id,
        language: 'HCL',
        framework: 'Terraform',
        database: '—',
        buildTool: 'Terraform',
        status: 'recommendation' as const,
      }
    }
    if (purpose === 'ml' || name.endsWith('-ml')) {
      return {
        repoId: repo.id,
        language: 'Python',
        framework: 'PyTorch / scikit-learn',
        database: 'Feature store / object storage',
        buildTool: 'poetry / Docker',
        status: 'recommendation' as const,
      }
    }
    if (purpose === 'workers' || name.endsWith('-workers')) {
      return {
        repoId: repo.id,
        language: 'TypeScript / Go',
        framework: 'Queue consumers',
        database: '—',
        buildTool: 'Docker',
        status: 'recommendation' as const,
      }
    }
    if (purpose === 'monorepo' || purpose === 'product' || purpose === 'application') {
      if (topology === 'frontend-only') {
        return {
          repoId: repo.id,
          language: 'TypeScript',
          framework: 'React 19 + Vite',
          database: '—',
          buildTool: 'npm / Vite',
          status: 'recommendation' as const,
        }
      }
      if (topology === 'ai-ml') {
        return {
          repoId: repo.id,
          language: 'TypeScript + Python',
          framework: 'API + model serving',
          database: 'PostgreSQL',
          buildTool: 'Docker Compose',
          status: 'recommendation' as const,
        }
      }
      return {
        repoId: repo.id,
        language: 'TypeScript / Java 21',
        framework: 'Full-stack application',
        database: 'PostgreSQL',
        buildTool: 'Docker',
        status: 'recommendation' as const,
      }
    }
    return {
      repoId: repo.id,
      language: topology === 'ai-ml' ? 'Python / Java 21' : 'Java 21',
      framework: topology === 'data-platform' ? 'Spring Boot 3.4 + data services' : 'Spring Boot 3.4',
      database: 'PostgreSQL',
      buildTool: 'Gradle',
      status: 'recommendation' as const,
    }
  })
}

export function platformOptionsForCloud(cloudProvider: string): {
  deployment: { id: string; label: string }[]
  iac: { id: string; label: string }[]
  secrets: { id: string; label: string }[]
  cicd: { id: string; label: string }[]
} {
  switch (cloudProvider) {
    case 'azure':
      return {
        deployment: [
          { id: 'aks', label: 'Azure Kubernetes (AKS)' },
          { id: 'app-service', label: 'Azure App Service' },
          { id: 'container-apps', label: 'Azure Container Apps' },
        ],
        iac: [
          { id: 'bicep', label: 'Bicep' },
          { id: 'terraform', label: 'Terraform' },
        ],
        secrets: [
          { id: 'azure-key-vault', label: 'Azure Key Vault' },
          { id: 'vault', label: 'HashiCorp Vault' },
        ],
        cicd: [
          { id: 'github-actions', label: 'GitHub Actions' },
          { id: 'azure-devops', label: 'Azure DevOps' },
        ],
      }
    case 'gcp':
      return {
        deployment: [
          { id: 'gke', label: 'Google Kubernetes (GKE)' },
          { id: 'cloud-run', label: 'Cloud Run' },
        ],
        iac: [
          { id: 'terraform', label: 'Terraform' },
          { id: 'pulumi', label: 'Pulumi' },
        ],
        secrets: [
          { id: 'gcp-secret-manager', label: 'GCP Secret Manager' },
          { id: 'vault', label: 'HashiCorp Vault' },
        ],
        cicd: [
          { id: 'github-actions', label: 'GitHub Actions' },
          { id: 'cloud-build', label: 'Cloud Build' },
        ],
      }
    case 'aws':
    default:
      return {
        deployment: [
          { id: 'kubernetes-eks', label: 'Kubernetes (EKS)' },
          { id: 'ecs', label: 'AWS ECS' },
          { id: 'lambda', label: 'AWS Lambda' },
        ],
        iac: [
          { id: 'terraform', label: 'Terraform' },
          { id: 'cloudformation', label: 'CloudFormation' },
        ],
        secrets: [
          { id: 'aws-secrets-manager', label: 'AWS Secrets Manager' },
          { id: 'vault', label: 'HashiCorp Vault' },
        ],
        cicd: [
          { id: 'github-actions', label: 'GitHub Actions' },
          { id: 'gitlab-ci', label: 'GitLab CI' },
          { id: 'jenkins', label: 'Jenkins' },
        ],
      }
  }
}

export function ensurePlatformDefaults(
  cloudProvider: string,
  current: {
    deploymentModel: string
    iac: string
    secretsManagement: string
    cicd: string
  },
): Partial<typeof current> {
  const opts = platformOptionsForCloud(cloudProvider)
  const patch: Partial<typeof current> = {}
  if (!opts.deployment.some((o) => o.id === current.deploymentModel)) {
    patch.deploymentModel = opts.deployment[0]?.id || current.deploymentModel
  }
  if (!opts.iac.some((o) => o.id === current.iac)) {
    patch.iac = opts.iac[0]?.id || current.iac
  }
  if (!opts.secrets.some((o) => o.id === current.secretsManagement)) {
    patch.secretsManagement = opts.secrets[0]?.id || current.secretsManagement
  }
  if (!opts.cicd.some((o) => o.id === current.cicd)) {
    patch.cicd = opts.cicd[0]?.id || current.cicd
  }
  return patch
}

export const GENERATION_CHECKLIST = [
  'All decisions resolved',
  'Repositories created',
  'Configurations generated',
  'SDLC structure generated',
  'Files packaged',
]

export const REVIEW_WARNINGS = [
  { id: 'missing', type: 'error', label: '3 Missing decisions', action: 'View' },
  { id: 'tbd', type: 'warn', label: '7 TBD items', action: 'View' },
  { id: 'arch', type: 'info', label: '2 Architecture warnings', action: 'View' },
]

export const PROVENANCE_LOG = [
  { who: 'Atul Sharma', what: 'Confirmed Spring Boot 3.4 for backend services', when: '2 hours ago' },
  { who: 'Priya Mehta', what: 'Updated React + Vite frontend stack', when: '1 hour ago' },
  { who: 'James Chen', what: 'Set OAuth2/JWT security requirements', when: '45 min ago' },
]
