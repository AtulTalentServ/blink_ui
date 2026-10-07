import { useEffect, useState, useCallback, useRef } from 'react'
import { ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'
import {
  connectIntegration,
  exchangeFigmaOAuth,
  exchangeGithubOAuth,
  exchangeJiraOAuth,
  fetchFigmaOAuthUrl,
  fetchFigmaProjects,
  fetchFigmaTeams,
  fetchFigmaFiles,
  fetchFigmaDesign,
  ingestFigmaDesign,
  fetchGithubOAuthUrl,
  fetchGithubOrgs,
  fetchJiraOAuthUrl,
  fetchJiraProjects,
  fetchMyIntegrations,
  fetchProjectIntegrations,
  applyMyIntegrationsToProject,
  saveIntegrationBinding,
  type GithubOrgItem,
  type JiraProjectItem,
  type FigmaFileItem,
} from '../api/blink'
import type { IntegrationItem } from '../wizard/defaults'
import { DEFAULT_INTEGRATIONS } from '../wizard/defaults'
import { mergeSavedIntegrations } from '../wizard/mergeIntegrations'
import type { WizardState } from '../wizard/types'
import { designFromBinding, figmaJiraRefs, figmaStoryRefs } from '../wizard/figmaDesign'
import { isJiraReady, jiraConnection } from '../wizard/jiraTickets'
import type { JiraPublishState } from '../wizard/thinking'
import { JiraPublishStatus } from './JiraScopePanel'
import { IntegrationLogo } from './IntegrationLogo'
import { subscribeOauthResult, type OauthResult } from '../oauth/channel'
import {
  isPopupBlocked,
  navigateOauthPopup,
  openOauthOnGesture,
  openOauthPlaceholder,
  watchOauthWindow,
} from '../oauth/popup'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  onEnsureProject?: () => Promise<{ id: string; created: boolean }>
  jiraPublish?: JiraPublishState | null
  stakeholderGovernanceBusy?: boolean
  onRetryStakeholderGovernance?: () => void
}

interface ConnectForm {
  token: string
  username: string
  email: string
  organization: string
  workspace: string
  baseUrl: string
  projectKey: string
  spaceKey: string
}

const EMPTY_FORM: ConnectForm = {
  token: '',
  username: '',
  email: '',
  organization: '',
  workspace: '',
  baseUrl: '',
  projectKey: '',
  spaceKey: '',
}

const GUIDES: Record<
  string,
  { tokenLabel: string; tokenUrl: string; steps: string[] }
> = {
  github: {
    tokenLabel: 'Access token',
    tokenUrl: 'https://github.com/settings/tokens/new?scopes=repo,read:org&description=BLINK',
    steps: [
      'Sign in with GitHub, or paste an access token if sign-in is blocked.',
      'The token needs permission to create repositories.',
    ],
  },
  figma: {
    tokenLabel: 'Access token',
    tokenUrl: 'https://www.figma.com/developers/api#access-tokens',
    steps: [
      'Sign in with Figma, or paste an access token if sign-in is blocked.',
      'Then pick a team, project, and the design file Blink should watch.',
      'Turn on Jira sync so screen changes comment on linked tickets.',
    ],
  },
  jira: {
    tokenLabel: 'API token',
    tokenUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    steps: [
      'Sign in with Atlassian, or paste an API token if sign-in is blocked.',
      'Enter your Cloud site, then pick the Jira project for tickets.',
    ],
  },
  confluence: {
    tokenLabel: 'API token',
    tokenUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    steps: [
      'Use the same Atlassian site and token as Jira.',
      'Space key is optional.',
    ],
  },
  bitbucket: {
    tokenLabel: 'App password',
    tokenUrl: 'https://bitbucket.org/account/settings/app-passwords/',
    steps: [
      'Create an app password with access to account, workspaces, and repositories.',
      'Enter your Bitbucket username and workspace.',
    ],
  },
}

const DISPLAY_CARDS = [
  {
    id: 'github',
    openId: 'github' as const,
    label: 'GitHub',
    purpose: 'Source control and new repositories',
  },
  {
    id: 'atlassian',
    openId: 'jira' as const,
    label: 'Atlassian',
    purpose: 'Jira issues and Confluence docs',
  },
  {
    id: 'figma',
    openId: 'figma' as const,
    label: 'Figma',
    purpose: 'Design files; screen changes can update Jira',
  },
  {
    id: 'bitbucket',
    openId: 'bitbucket' as const,
    label: 'Bitbucket',
    purpose: 'Git hosting in an Atlassian workspace',
  },
]

function purposeFor(id: string): string {
  return DISPLAY_CARDS.find((card) => card.id === id || card.openId === id)?.purpose ?? DISPLAY_CARDS[0].purpose
}

function formFromItem(item: IntegrationItem, jira?: IntegrationItem): ConnectForm {
  const fromJira = item.id === 'confluence' && jira?.connected
  return {
    ...EMPTY_FORM,
    baseUrl: item.baseUrl || (fromJira ? jira?.baseUrl ?? '' : item.id === 'github' ? 'https://github.com' : item.id === 'figma' ? 'https://www.figma.com' : ''),
    email: item.email || (fromJira ? jira?.email ?? '' : ''),
    organization: item.organization ?? '',
    workspace: item.workspace ?? '',
    username: item.username ?? '',
    projectKey: item.projectKey ?? '',
    spaceKey: item.spaceKey ?? '',
  }
}

export function IntegrationsScreen({
  state,
  onUpdate,
  onEnsureProject,
  jiraPublish = null,
  stakeholderGovernanceBusy = false,
  onRetryStakeholderGovernance,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [form, setForm] = useState<ConnectForm>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [oauthNotice, setOauthNotice] = useState<string | null>(null)
  const [oauthResume, setOauthResume] = useState<{ provider: 'github' | 'jira' | 'figma'; url: string } | null>(null)
  const [projects, setProjects] = useState<JiraProjectItem[]>([])
  const [githubOrgs, setGithubOrgs] = useState<GithubOrgItem[]>([])
  const [figmaTeams, setFigmaTeams] = useState<GithubOrgItem[]>([])
  const [figmaFiles, setFigmaFiles] = useState<FigmaFileItem[]>([])
  const [discoveringProjects, setDiscoveringProjects] = useState(false)
  const [discoveringOrgs, setDiscoveringOrgs] = useState(false)
  const [discoveringFiles, setDiscoveringFiles] = useState(false)
  const [ingestingDesign, setIngestingDesign] = useState(false)
  const [isCustomProjectKey, setIsCustomProjectKey] = useState(false)
  const [selectedProjectName, setSelectedProjectName] = useState('')
  const oauthRedirectUriRef = useRef<string | undefined>(undefined)
  const githubOrgRef = useRef('')
  const projectIdRef = useRef(state.projectId)
  const stopWatchingOauthRef = useRef<(() => void) | null>(null)
  const lastOauthCodeRef = useRef<string | null>(null)

  useEffect(() => {
    projectIdRef.current = state.projectId
  }, [state.projectId])

  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      try {
        let saved = state.projectId
          ? await fetchProjectIntegrations(state.projectId)
          : await fetchMyIntegrations()
        if (cancelled) return
        if (state.projectId && saved.length === 0) {
          saved = await applyMyIntegrationsToProject(state.projectId)
          if (cancelled) return
        }
        if (!saved.length) return
        const merged = mergeSavedIntegrations(state.integrations, saved)
        const changed = merged.some((item, i) => {
          const cur = state.integrations.find((c) => c.id === item.id) || state.integrations[i]
          return Boolean(item.connected) !== Boolean(cur?.connected) || item.account !== cur?.account || item.projectKey !== cur?.projectKey
        })
        if (changed) onUpdate({ integrations: merged })
        if (state.projectId) {
          const design = await fetchFigmaDesign(state.projectId)
          if (cancelled) return
          if (design.bound) {
            onUpdate({ figmaDesign: designFromBinding(design, state.figmaDesign) })
          }
        }
      } catch {
        /* ignore hydrate errors */
      }
    }
    void hydrate()
    return () => {
      cancelled = true
    }
    // Re-run when project changes; avoid thrashing on every integrations edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.projectId, onUpdate])

  const requireStoredProject = useCallback(async (): Promise<string> => {
    if (projectIdRef.current) return projectIdRef.current
    if (!onEnsureProject) {
      throw new Error('Save the project on Project & Stakeholders first so Blink can store this connection.')
    }
    const result = await onEnsureProject()
    projectIdRef.current = result.id
    if (result.created) {
      setOauthNotice('Created a draft project so this connection can be stored. You can rename it on Project & Stakeholders.')
    }
    return result.id
  }, [onEnsureProject])

  const active = state.integrations.find((item) => item.id === activeId) ?? null
  const jira = state.integrations.find((item) => item.id === 'jira')
  const confluence = state.integrations.find((item) => item.id === 'confluence')
  const guide = active ? GUIDES[active.id] : null

  useEffect(() => {
    const known = new Set(state.integrations.map((item) => item.id))
    const missing = DEFAULT_INTEGRATIONS.filter((item) => !known.has(item.id))
    if (missing.length === 0) return
    onUpdate({ integrations: [...state.integrations, ...missing.map((item) => ({ ...item }))] })
  }, [onUpdate, state.integrations])

  const patchItem = useCallback(
    (id: string, updates: Partial<IntegrationItem>) => {
      onUpdate({
        integrations: state.integrations.map((item) => (item.id === id ? { ...item, ...updates } : item)),
      })
    },
    [onUpdate, state.integrations],
  )

  useEffect(() => {
    if (!activeId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving && !oauthLoading) setActiveId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, saving, oauthLoading])

  const stopWatchingOauth = () => {
    stopWatchingOauthRef.current?.()
    stopWatchingOauthRef.current = null
  }

  const watchOpenedOauth = (popup: Window) => {
    stopWatchingOauth()
    stopWatchingOauthRef.current = watchOauthWindow(popup, () => {
      setOauthLoading(false)
      stopWatchingOauthRef.current = null
    })
  }

  const completeOauth = useCallback(
    async (result: OauthResult) => {
      if (result.code && lastOauthCodeRef.current === result.code) return
      if (result.code) lastOauthCodeRef.current = result.code
      if (result.type === 'GITHUB_OAUTH_RESPONSE') {
        if (result.error) {
          setError(`GitHub authorization failed: ${result.error}`)
          setOauthLoading(false)
          return
        }
        if (!result.code) return
        setOauthLoading(true)
        setError(null)
        setOauthResume(null)
        try {
          const res = await exchangeGithubOAuth(
            result.code,
            oauthRedirectUriRef.current,
            projectIdRef.current,
            githubOrgRef.current || undefined,
          )
          const orgs = res.organizations || []
          setGithubOrgs(orgs)
          setForm((prev) => ({ ...prev, organization: res.organization || githubOrgRef.current || '' }))
          patchItem('github', {
            connected: true,
            account: res.account,
            detail: res.detail,
            baseUrl: res.baseUrl || 'https://github.com',
            organization: res.organization || githubOrgRef.current || undefined,
            authType: 'oauth',
            token: undefined,
            availableOrganizations: orgs,
          })
          setActiveId('github')
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to complete GitHub OAuth.')
        } finally {
          setOauthLoading(false)
          stopWatchingOauth()
        }
        return
      }
      if (result.type === 'FIGMA_OAUTH_RESPONSE') {
        if (result.error) {
          setError(`Figma authorization failed: ${result.error}`)
          setOauthLoading(false)
          return
        }
        if (!result.code) return
        setOauthLoading(true)
        setError(null)
        setOauthResume(null)
        try {
          const res = await exchangeFigmaOAuth(
            result.code,
            oauthRedirectUriRef.current,
            projectIdRef.current,
            githubOrgRef.current || undefined,
          )
          const teams = res.organizations || []
          setFigmaTeams(teams)
          setProjects(res.projects || [])
          setSelectedProjectName(res.projectName || '')
          setForm((prev) => ({
            ...prev,
            organization: res.organization || githubOrgRef.current || '',
            projectKey: res.projectKey || prev.projectKey,
            baseUrl: res.baseUrl || prev.baseUrl || 'https://www.figma.com',
          }))
          patchItem('figma', {
            connected: true,
            account: res.account,
            detail: res.detail,
            baseUrl: res.baseUrl || 'https://www.figma.com',
            organization: res.organization || githubOrgRef.current || undefined,
            projectKey: res.projectKey,
            projectName: res.projectName,
            authType: 'oauth',
            token: undefined,
            availableOrganizations: teams,
            availableProjects: res.projects,
          })
          setActiveId('figma')
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to complete Figma OAuth.')
        } finally {
          setOauthLoading(false)
          stopWatchingOauth()
        }
        return
      }
      if (result.error) {
        setError(`Atlassian authorization failed: ${result.error}`)
        setOauthLoading(false)
        return
      }
      if (!result.code) return
      setOauthLoading(true)
      setError(null)
      setOauthResume(null)
      try {
        const res = await exchangeJiraOAuth(result.code, oauthRedirectUriRef.current, projectIdRef.current)
        patchItem('jira', {
          connected: true,
          account: res.account,
          detail: res.detail,
          baseUrl: res.baseUrl,
          cloudId: res.cloudId,
          authType: 'oauth',
          token: undefined,
          projectKey: res.projectKey,
          projectName: res.projectName,
          availableProjects: res.projects,
        })
        setForm((prev) => ({
          ...prev,
          projectKey: res.projectKey || prev.projectKey,
          baseUrl: res.baseUrl || prev.baseUrl,
        }))
        setProjects(res.projects || [])
        setSelectedProjectName(res.projectName || '')
        setActiveId('jira')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to complete Atlassian OAuth.')
      } finally {
        setOauthLoading(false)
        stopWatchingOauth()
      }
    },
    [patchItem],
  )

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GITHUB_OAUTH_RESPONSE' || event.data?.type === 'JIRA_OAUTH_RESPONSE' || event.data?.type === 'FIGMA_OAUTH_RESPONSE') {
        void completeOauth(event.data as OauthResult)
      }
    }
    window.addEventListener('message', handleMessage)
    const stopChannel = subscribeOauthResult((result) => void completeOauth(result))
    return () => {
      window.removeEventListener('message', handleMessage)
      stopChannel()
    }
  }, [completeOauth])

  const openConnect = (item: IntegrationItem) => {
    setError(null)
    setOauthNotice(null)
    setForm({
      ...formFromItem(item, jira),
      ...(item.id === 'jira'
        ? {
            spaceKey: confluence?.spaceKey || '',
            baseUrl: item.baseUrl || confluence?.baseUrl || '',
            email: item.email || confluence?.email || '',
          }
        : {}),
    })
    setActiveId(item.id)

    if (item.id === 'jira') {
      const existingProjects = item.availableProjects || []
      setProjects(existingProjects)
      const hasMatch = existingProjects.some((p) => p.key === item.projectKey)
      setIsCustomProjectKey(!hasMatch && Boolean(item.projectKey))
      setSelectedProjectName(item.projectName || '')

      if (item.connected && existingProjects.length === 0) {
        void fetchJiraProjects({
          projectId: state.projectId,
          baseUrl: item.baseUrl,
          email: item.email,
          cloudId: item.cloudId,
        })
          .then((list) => {
            if (list.length > 0) {
              setProjects(list)
              patchItem('jira', { availableProjects: list })
            }
          })
          .catch(() => {
            // ignore initial silent auto-refresh
          })
      }
    }

    if (item.id === 'github') {
      const existingOrgs = item.availableOrganizations || []
      setGithubOrgs(existingOrgs)
      if (item.connected && existingOrgs.length === 0 && state.projectId) {
        void fetchGithubOrgs({ projectId: state.projectId })
          .then((list) => {
            if (list.length > 0) {
              setGithubOrgs(list)
              patchItem('github', { availableOrganizations: list })
            }
          })
          .catch(() => {
            /* ignore initial silent auto-refresh */
          })
      }
    }

    if (item.id === 'figma') {
      const existingTeams = item.availableOrganizations || []
      setFigmaTeams(existingTeams)
      setProjects(item.availableProjects || [])
      setSelectedProjectName(item.projectName || '')
      if (item.connected && existingTeams.length === 0 && state.projectId) {
        void fetchFigmaTeams({ projectId: state.projectId })
          .then((list) => {
            if (list.length > 0) {
              setFigmaTeams(list)
              patchItem('figma', { availableOrganizations: list })
            }
          })
          .catch(() => {
            /* ignore initial silent auto-refresh */
          })
      }
    }
  }

  const disconnect = (id: string) => {
    const ids = id === 'jira' || id === 'confluence' ? ['jira', 'confluence'] : [id]
    onUpdate({
      integrations: state.integrations.map((item) =>
        ids.includes(item.id)
          ? {
              ...item,
              connected: false,
              account: undefined,
              detail: undefined,
              token: undefined,
              cloudId: undefined,
              authType: undefined,
              projectKey: undefined,
              projectName: undefined,
              availableProjects: undefined,
              organization: undefined,
              availableOrganizations: undefined,
              spaceKey: undefined,
            }
          : item,
      ),
    })
    setActiveId(null)
  }

  const handleStartOAuth = async () => {
    const popup = openOauthPlaceholder('atlassian_oauth', 'Atlassian')
    setError(null)
    setOauthNotice(null)
    setOauthResume(null)
    setOauthLoading(true)
    try {
      await requireStoredProject()
      const urlRes = await fetchJiraOAuthUrl()
      oauthRedirectUriRef.current = urlRes.redirectUri
      if (!urlRes.configured || !urlRes.url) {
        popup?.close()
        setOauthNotice(
          urlRes.message ||
            'Atlassian OAuth Client ID is not configured on the server. You can connect using an API token below.'
        )
        setOauthLoading(false)
        return
      }
      const authUrl = urlRes.url
      if (popup && !isPopupBlocked(popup) && navigateOauthPopup(popup, authUrl)) {
        watchOpenedOauth(popup)
        window.setTimeout(() => {
          if (!isPopupBlocked(popup)) return
          setOauthResume({ provider: 'jira', url: authUrl })
          setOauthLoading(false)
        }, 500)
        return
      }
      popup?.close()
      setOauthResume({ provider: 'jira', url: authUrl })
      setOauthLoading(false)
    } catch (err) {
      popup?.close()
      setError(err instanceof Error ? err.message : 'Could not initialize Atlassian OAuth.')
      setOauthLoading(false)
    }
  }

  const cancelOauth = useCallback(() => {
    stopWatchingOauth()
    setOauthLoading(false)
    setOauthResume(null)
    setOauthNotice('Connection cancelled. Close any GitHub popup, wait a few seconds, then try again.')
  }, [])

  const handleStartGithubOAuth = async () => {
    const popup = openOauthPlaceholder('github_oauth', 'GitHub')
    setError(null)
    setOauthNotice(null)
    setOauthResume(null)
    setOauthLoading(true)
    // Soft timeout — Neon congestion can leave the button on Connecting… forever.
    const timeout = window.setTimeout(() => {
      setOauthLoading((busy) => {
        if (!busy) return busy
        setOauthNotice(
          'GitHub connect is taking too long (API busy). Click Cancel, close the popup, wait ~30s, then try again.',
        )
        return false
      })
    }, 45_000)
    try {
      // Fetch the OAuth URL first so the popup is not stuck on "Connecting…" behind slow project saves.
      githubOrgRef.current = form.organization.trim()
      const urlRes = await fetchGithubOAuthUrl()
      oauthRedirectUriRef.current = urlRes.redirectUri
      if (!urlRes.configured || !urlRes.url) {
        popup?.close()
        setOauthNotice(
          urlRes.message ||
            'GitHub OAuth is not configured on the server. Set BLINK_GITHUB_CLIENT_ID and BLINK_GITHUB_CLIENT_SECRET.',
        )
        setOauthLoading(false)
        return
      }
      const authUrl = urlRes.url
      if (popup && !isPopupBlocked(popup) && navigateOauthPopup(popup, authUrl)) {
        watchOpenedOauth(popup)
        window.setTimeout(() => {
          if (!isPopupBlocked(popup)) return
          setOauthResume({ provider: 'github', url: authUrl })
          setOauthLoading(false)
        }, 500)
        // Persist project id in the background (already saved projects return immediately).
        void requireStoredProject().catch(() => undefined)
        return
      }
      popup?.close()
      setOauthResume({ provider: 'github', url: authUrl })
      setOauthLoading(false)
      void requireStoredProject().catch(() => undefined)
    } catch (err) {
      popup?.close()
      setError(err instanceof Error ? err.message : 'Could not initialize GitHub OAuth.')
      setOauthLoading(false)
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const handleStartFigmaOAuth = async () => {
    const popup = openOauthPlaceholder('figma_oauth', 'Figma')
    setError(null)
    setOauthNotice(null)
    setOauthResume(null)
    setOauthLoading(true)
    try {
      await requireStoredProject()
      githubOrgRef.current = form.organization.trim()
      const urlRes = await fetchFigmaOAuthUrl()
      oauthRedirectUriRef.current = urlRes.redirectUri
      if (!urlRes.configured || !urlRes.url) {
        popup?.close()
        setOauthNotice(
          urlRes.message ||
            'Figma OAuth is not configured on the server. Set BLINK_FIGMA_CLIENT_ID and BLINK_FIGMA_CLIENT_SECRET.',
        )
        setOauthLoading(false)
        return
      }
      if (popup && !isPopupBlocked(popup) && navigateOauthPopup(popup, urlRes.url)) {
        watchOpenedOauth(popup)
        return
      }
      popup?.close()
      setOauthResume({ provider: 'figma', url: urlRes.url })
      setOauthLoading(false)
    } catch (err) {
      popup?.close()
      setError(err instanceof Error ? err.message : 'Could not initialize Figma OAuth.')
      setOauthLoading(false)
    }
  }

  const handleResumeOauth = () => {
    if (!oauthResume) return
    setError(null)
    const opened = openOauthOnGesture(
      oauthResume.url,
      oauthResume.provider === 'github' ? 'github_oauth' : oauthResume.provider === 'figma' ? 'figma_oauth' : 'atlassian_oauth',
    )
    if (!opened) {
      setError('Allow popups for Blink, then click Continue again.')
      return
    }
    setOauthResume(null)
    setOauthLoading(true)
    watchOpenedOauth(opened)
  }

  const handleDiscoverProjects = async () => {
    if (!active) return
    const payload = {
      projectId: state.projectId || undefined,
      cloudId: active.cloudId,
      baseUrl: form.baseUrl.trim() || active.baseUrl,
      email: form.email.trim() || active.email,
      token: form.token.trim() || undefined,
    }

    if (!state.projectId && !payload.cloudId && (!payload.baseUrl || !payload.email || !payload.token)) {
      setError('Enter Cloud site URL, email, and API token to discover projects.')
      return
    }

    setDiscoveringProjects(true)
    setError(null)
    try {
      const list = await fetchJiraProjects(payload)
      setProjects(list)
      patchItem(active.id, { availableProjects: list })
      if (list.length > 0 && !form.projectKey) {
        setForm((prev) => ({ ...prev, projectKey: list[0].key }))
        setSelectedProjectName(list[0].name)
        if (active.connected) {
          patchItem(active.id, { projectKey: list[0].key, projectName: list[0].name })
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fetch Jira projects.')
    } finally {
      setDiscoveringProjects(false)
    }
  }

  const handleProjectSelect = (val: string) => {
    if (val === '__custom__') {
      setIsCustomProjectKey(true)
    } else {
      setIsCustomProjectKey(false)
      const matched = projects.find((p) => p.key === val)
      setForm((prev) => ({ ...prev, projectKey: val }))
      setSelectedProjectName(matched?.name || '')
      if (active?.connected) {
        patchItem(active.id, { projectKey: val, projectName: matched?.name })
        if (state.projectId) {
          void saveIntegrationBinding({
            projectId: state.projectId,
            provider: active.id,
            projectKey: val,
            projectName: matched?.name,
          }).catch(() => {
            // selection is still kept in the wizard; reconnect if the server missed it
          })
          if (active.id === 'figma' && val) {
            void handleDiscoverFigmaFiles(val)
          }
        }
      }
    }
  }

  const handleDiscoverOrgs = async () => {
    if (!active || (active.id !== 'github' && active.id !== 'figma')) return
    setDiscoveringOrgs(true)
    setError(null)
    try {
      const projectId = await requireStoredProject()
      const list = active.id === 'figma' ? await fetchFigmaTeams({ projectId }) : await fetchGithubOrgs({ projectId })
      if (active.id === 'figma') setFigmaTeams(list)
      else setGithubOrgs(list)
      patchItem(active.id, { availableOrganizations: list })
    } catch (err) {
      setError(err instanceof Error ? err.message : active.id === 'figma' ? 'Could not fetch Figma teams.' : 'Could not fetch GitHub organizations.')
    } finally {
      setDiscoveringOrgs(false)
    }
  }

  const handleOrgSelect = (val: string) => {
    setForm((prev) => ({ ...prev, organization: val, projectKey: active?.id === 'figma' ? '' : prev.projectKey }))
    githubOrgRef.current = val
    if (!active?.connected) {
      return
    }
    const provider = active.id
    patchItem(provider, {
      organization: val || undefined,
      detail: val ? `Connected as ${active.account} to ${val}` : `Connected as ${active.account}`,
      projectKey: provider === 'figma' ? undefined : active.projectKey,
      projectName: provider === 'figma' ? undefined : active.projectName,
    })
    if (state.projectId) {
      void saveIntegrationBinding({
        projectId: state.projectId,
        provider,
        organization: val,
      }).catch(() => {
        // selection is still kept in the wizard; reconnect if the server missed it
      })
    }
    if (provider === 'figma' && val && state.projectId) {
      void fetchFigmaProjects({ projectId: state.projectId, organization: val })
        .then((list) => {
          setProjects(list)
          patchItem('figma', { availableProjects: list })
        })
        .catch(() => {
          setProjects([])
        })
    }
  }

  const handleDiscoverFigmaFiles = async (figmaProjectId?: string) => {
    if (!state.projectId) return
    const projectKey = figmaProjectId || form.projectKey
    if (!projectKey) return
    setDiscoveringFiles(true)
    setError(null)
    try {
      const list = await fetchFigmaFiles({ projectId: state.projectId, figmaProjectId: projectKey })
      setFigmaFiles(list)
      onUpdate({
        figmaDesign: {
          ...(state.figmaDesign || {}),
          availableFiles: list,
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not list Figma files.')
    } finally {
      setDiscoveringFiles(false)
    }
  }

  const handleFigmaFileSelect = (fileKey: string) => {
    const matched = figmaFiles.find((file) => file.key === fileKey)
    onUpdate({
      figmaDesign: {
        ...(state.figmaDesign || {}),
        fileKey,
        fileName: matched?.name,
        fileUrl: fileKey ? `https://www.figma.com/design/${fileKey}` : undefined,
        availableFiles: figmaFiles,
        syncJira: state.figmaDesign?.syncJira !== false,
      },
    })
  }

  const handleIngestFigma = async () => {
    if (!state.projectId || !state.figmaDesign?.fileKey) {
      setError('Pick a Figma file first.')
      return
    }
    setIngestingDesign(true)
    setError(null)
    try {
      const result = await ingestFigmaDesign({
        projectId: state.projectId,
        fileKey: state.figmaDesign.fileKey,
        fileUrl: state.figmaDesign.fileUrl,
        syncJira: state.figmaDesign.syncJira !== false,
        stories: figmaStoryRefs(state),
        jiraIssues: figmaJiraRefs(state),
      })
      onUpdate({
        figmaDesign: designFromBinding(result, {
          ...state.figmaDesign,
          availableFiles: figmaFiles,
        }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not ingest the Figma file.')
    } finally {
      setIngestingDesign(false)
    }
  }

  const handleConnect = async () => {
    if (!active) return
    if ((active.id === 'jira' || active.id === 'confluence') && (!form.baseUrl.trim() || !form.email.trim())) {
      setError('Cloud site URL and Atlassian email are required.')
      return
    }
    if (active.id === 'bitbucket' && (!form.workspace.trim() || !form.username.trim())) {
      setError('Workspace and username are required.')
      return
    }
    if ((active.id === 'github' || active.id === 'figma') && !form.token.trim() && !active.connected) {
      setError(
        active.id === 'figma'
          ? 'Paste a Figma access token, or continue with Figma.'
          : 'Paste a GitHub access token, or continue with GitHub.',
      )
      return
    }
    setSaving(true)
    setError(null)
    try {
      const projectId = await requireStoredProject()
      if (active.connected && !form.token.trim() && (form.projectKey.trim() || form.spaceKey.trim() || form.organization.trim())) {
        const result = await saveIntegrationBinding({
          projectId,
          provider: active.id,
          projectKey: form.projectKey.trim() || undefined,
          projectName: selectedProjectName || undefined,
          spaceKey: form.spaceKey.trim() || undefined,
          organization: form.organization.trim() || undefined,
        })
        patchItem(active.id, {
          projectKey: form.projectKey.trim() || result.projectKey,
          projectName: selectedProjectName || result.projectName,
          organization: form.organization.trim() || result.organization,
          spaceKey: form.spaceKey.trim() || undefined,
          token: undefined,
        })
        setActiveId(null)
        return
      }
      const payload = {
        provider: active.id,
        projectId,
        token: form.token.trim(),
        username: form.username.trim() || undefined,
        email: form.email.trim() || undefined,
        organization: form.organization.trim() || undefined,
        workspace: form.workspace.trim() || undefined,
        baseUrl: form.baseUrl.trim() || undefined,
        projectKey: form.projectKey.trim() || undefined,
        spaceKey: form.spaceKey.trim() || undefined,
      }
      const result = await connectIntegration(payload)
      const projKey = form.projectKey.trim() || result.projectKey
      const projName = selectedProjectName || result.projectName
      const finalProjects = result.projects && result.projects.length > 0 ? result.projects : projects
      const orgs = result.organizations || []
      if (active.id === 'github' && orgs.length > 0) {
        setGithubOrgs(orgs)
      }
      if (active.id === 'figma' && orgs.length > 0) {
        setFigmaTeams(orgs)
      }
      if (active.id === 'figma' && finalProjects.length > 0) {
        setProjects(finalProjects)
      }
      patchItem(active.id, {
        connected: true,
        account: result.account,
        detail: result.detail,
        token: undefined,
        baseUrl: payload.baseUrl || result.baseUrl,
        organization: result.organization || payload.organization,
        workspace: payload.workspace,
        email: payload.email,
        username: payload.username,
        projectKey: projKey,
        projectName: projName,
        cloudId: result.cloudId,
        authType: (result.authType as 'oauth' | 'token') || 'token',
        spaceKey: payload.spaceKey,
        availableProjects: finalProjects,
        availableOrganizations: active.id === 'github' || active.id === 'figma' ? orgs : undefined,
      })
      if (active.id === 'jira' && payload.token && (payload.baseUrl || result.baseUrl) && payload.email) {
        try {
          const wiki = await connectIntegration({
            provider: 'confluence',
            projectId,
            baseUrl: payload.baseUrl || result.baseUrl,
            email: payload.email,
            token: payload.token,
            spaceKey: payload.spaceKey,
          })
          patchItem('confluence', {
            connected: true,
            account: wiki.account,
            detail: wiki.detail,
            baseUrl: payload.baseUrl || result.baseUrl,
            email: payload.email,
            spaceKey: payload.spaceKey,
            authType: 'token',
          })
        } catch {
          // Jira can succeed without Confluence; user can retry with a space key and token.
        }
      }
      setForm((prev) => ({ ...prev, token: '', organization: result.organization || prev.organization }))
      if (active.id !== 'github' && active.id !== 'jira' && active.id !== 'figma') {
        setActiveId(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not connect ${active.label}.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen screen-ref">
      <div className="screen-header">
        <h2>Integrations</h2>
        <p>Connect GitHub, Atlassian, Figma, and Bitbucket.</p>
      </div>

      {error && !active && (
        <p className="status-banner error" role="alert">
          {error}
        </p>
      )}

      {(stakeholderGovernanceBusy || state.governanceStatus === 'preparing') && (
        <p className="status-banner info governance-sync-banner" role="status">
          <Loader2 size={16} className="spin" aria-hidden />
          <span>
            Saving stakeholder roles and governance in the background. You can connect integrations while this finishes.
          </span>
        </p>
      )}

      {state.governanceStatus === 'failed' && !stakeholderGovernanceBusy && (
        <div className="status-banner error governance-sync-banner" role="alert">
          <span>Stakeholder governance did not finish. Requirements planning may be missing role overlays.</span>
          {onRetryStakeholderGovernance ? (
            <button type="button" className="secondary-btn" onClick={onRetryStakeholderGovernance}>
              <RefreshCw size={14} aria-hidden />
              Retry governance
            </button>
          ) : null}
        </div>
      )}

      {state.governanceStatus === 'ready' && (state.sodWarnings?.length || 0) > 0 && (
        <p className="status-banner info governance-sync-banner" role="status">
          Separation-of-duties notes: {state.sodWarnings.join(' · ')}
        </p>
      )}

      {(jiraPublish?.active || jiraPublish?.message) && (
        <JiraPublishStatus
          publish={jiraPublish}
          jiraReady={isJiraReady(state)}
          pendingCount={0}
          projectKey={jiraConnection(state)?.projectKey}
        />
      )}

      <section className="card ref-card integrations-connect-panel">
        <div className="integration-grid ref">
          {DISPLAY_CARDS.map((card) => {
            const providers = card.openId === 'jira' ? [jira, confluence] : [state.integrations.find((item) => item.id === card.openId)]
            const primary = card.openId === 'jira' ? jira : state.integrations.find((item) => item.id === card.openId)
            const connected = providers.some((item) => item?.connected)
            const status =
              card.openId === 'jira'
                ? [
                    jira?.connected && jira.account
                      ? `${jira.account}${jira.projectKey ? ` • ${jira.projectKey}` : ''}`
                      : null,
                    confluence?.connected ? 'Confluence' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : primary?.connected && primary.account
                  ? `${primary.account}${primary.organization ? ` • ${primary.organization}` : ''}`
                  : ''
            return (
              <article key={card.id} className={`integration-card ref ${connected ? 'connected' : ''}`}>
                <IntegrationLogo id={card.id} label={card.label} />
                <div className="int-body">
                  <strong>{card.label}</strong>
                  <span className="int-purpose">{card.purpose}</span>
                  {connected && status ? <span className="int-account">{status}</span> : null}
                </div>
                <div className="int-card-actions">
                  {connected ? <span className="connected-label">Connected</span> : null}
                  <button
                    type="button"
                    className={connected ? 'secondary-btn' : 'primary-btn'}
                    onClick={() => primary && openConnect(primary)}
                  >
                    {connected ? 'Manage' : 'Connect'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {active && guide && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!saving && !oauthLoading) setActiveId(null)
          }}
        >
          <div
            className="connect-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="connect-modal-header">
              <div>
                <h3 id="connect-title">
                  <IntegrationLogo id={active.id} label={active.id === 'jira' || active.id === 'confluence' ? 'Atlassian' : active.label} />
                  Connect {active.id === 'jira' || active.id === 'confluence' ? 'Atlassian' : active.label}
                </h3>
                <p>{purposeFor(active.id)}</p>
              </div>
              <button
                type="button"
                className="icon-btn connect-close"
                aria-label="Close"
                disabled={saving || oauthLoading}
                onClick={() => setActiveId(null)}
              >
                <X size={16} />
              </button>
            </header>

            {active.id === 'github' && !active.connected && (
              <div className="oauth-card">
                <div className="oauth-card-head">
                  <strong>Sign in with GitHub</strong>
                </div>
                <p className="oauth-card-copy">Opens a GitHub window. If your browser blocks it, use the prompt below.</p>
                <div className="row-actions" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="oauth-btn github"
                    disabled={saving || oauthLoading}
                    onClick={() => void handleStartGithubOAuth()}
                  >
                    {oauthLoading ? 'Connecting…' : 'Continue with GitHub'}
                  </button>
                  {oauthLoading ? (
                    <button type="button" className="secondary-btn" onClick={cancelOauth}>
                      Cancel
                    </button>
                  ) : null}
                </div>
                {oauthResume?.provider === 'github' && (
                  <div className="oauth-blocked">
                    <p>Your browser blocked the GitHub window.</p>
                    <button type="button" className="oauth-btn github" onClick={handleResumeOauth}>
                      Continue with GitHub
                    </button>
                    <a
                      className="oauth-resume-link"
                      href={oauthResume.url}
                      target="github_oauth"
                      rel="opener"
                      onClick={() => {
                        setOauthLoading(true)
                        setOauthResume(null)
                      }}
                    >
                      Open GitHub in a new tab
                    </a>
                  </div>
                )}
                {oauthNotice && <p className="oauth-notice">{oauthNotice}</p>}
              </div>
            )}

            {active.id === 'figma' && !active.connected && (
              <div className="oauth-card">
                <div className="oauth-card-head">
                  <strong>Sign in with Figma</strong>
                </div>
                <p className="oauth-card-copy">Opens a Figma window. If your browser blocks it, use the prompt below.</p>
                <button
                  type="button"
                  className="oauth-btn figma"
                  disabled={saving || oauthLoading}
                  onClick={() => void handleStartFigmaOAuth()}
                >
                  {oauthLoading ? 'Connecting…' : 'Continue with Figma'}
                </button>
                {oauthResume?.provider === 'figma' && (
                  <div className="oauth-blocked">
                    <p>Your browser blocked the Figma window.</p>
                    <button type="button" className="oauth-btn figma" onClick={handleResumeOauth}>
                      Continue with Figma
                    </button>
                    <a
                      className="oauth-resume-link"
                      href={oauthResume.url}
                      target="figma_oauth"
                      rel="opener"
                      onClick={() => {
                        setOauthLoading(true)
                        setOauthResume(null)
                      }}
                    >
                      Open Figma in a new tab
                    </a>
                  </div>
                )}
                {oauthNotice && <p className="oauth-notice">{oauthNotice}</p>}
              </div>
            )}

            {active.id === 'jira' && !active.connected && (
              <div className="oauth-card">
                <div className="oauth-card-head">
                  <strong>Sign in with Atlassian</strong>
                </div>
                <p className="oauth-card-copy">Connects Jira tickets and Confluence docs on the same site.</p>
                <button
                  type="button"
                  className="oauth-btn"
                  disabled={saving || oauthLoading}
                  onClick={() => void handleStartOAuth()}
                >
                  {oauthLoading ? 'Connecting…' : 'Continue with Atlassian'}
                </button>
                {oauthResume?.provider === 'jira' && (
                  <div className="oauth-blocked">
                    <p>Your browser blocked the Atlassian window.</p>
                    <button type="button" className="oauth-btn" onClick={handleResumeOauth}>
                      Continue with Atlassian
                    </button>
                    <a
                      className="oauth-resume-link"
                      href={oauthResume.url}
                      target="atlassian_oauth"
                      rel="opener"
                      onClick={() => {
                        setOauthLoading(true)
                        setOauthResume(null)
                      }}
                    >
                      Open Atlassian in a new tab
                    </a>
                  </div>
                )}
                {oauthNotice && <p className="oauth-notice">{oauthNotice}</p>}
              </div>
            )}

            {(active.id === 'jira' || active.id === 'github' || active.id === 'figma') && !active.connected && (
              <div className="connect-divider">
                <span>or use an access token</span>
              </div>
            )}

            {active.id === 'bitbucket' && (
              <ol className="connect-steps">
                {guide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
            {!active.connected && (
              <a className="token-link" href={guide.tokenUrl} target="_blank" rel="noreferrer">
                Create {guide.tokenLabel.toLowerCase()} <ExternalLink size={14} />
              </a>
            )}

            <div className="connect-fields">
              {(active.id === 'github' || active.id === 'figma') && active.connected && (
                <div className="field-group">
                  <div className="field-label-row">
                    <label htmlFor={active.id === 'figma' ? 'figma-team-select' : 'gh-org-select'}>
                      {active.id === 'figma' ? 'Figma team' : 'GitHub destination'}
                    </label>
                    <button
                      type="button"
                      className="mini-btn"
                      disabled={discoveringOrgs}
                      onClick={() => void handleDiscoverOrgs()}
                    >
                      <RefreshCw size={11} className={discoveringOrgs ? 'spin' : ''} />
                      {discoveringOrgs ? 'Loading…' : active.id === 'figma' ? 'Find teams' : 'Find organizations'}
                    </button>
                  </div>
                  {active.id === 'github' ? (
                    <select
                      id="gh-org-select"
                      value={form.organization}
                      onChange={(e) => handleOrgSelect(e.target.value)}
                    >
                      <option value="">Personal account{active.account ? ` (${active.account})` : ''}</option>
                      {githubOrgs
                        .filter((org) => !org.personal)
                        .map((org) => (
                          <option key={org.login} value={org.login}>
                            {org.name && org.name !== org.login ? `${org.name} (${org.login})` : org.login}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <>
                      {figmaTeams.length > 0 && (
                        <select
                          id="figma-team-select"
                          value={figmaTeams.some((team) => team.login === form.organization) ? form.organization : ''}
                          onChange={(e) => handleOrgSelect(e.target.value)}
                        >
                          <option value="">Choose a Figma team</option>
                          {figmaTeams.map((team) => (
                            <option key={team.login} value={team.login}>
                              {team.name && team.name !== team.login ? `${team.name} (${team.login})` : team.name || team.login}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        id="figma-team-url"
                        value={form.organization}
                        onChange={(e) => {
                          const val = e.target.value
                          setForm((prev) => ({ ...prev, organization: val }))
                          githubOrgRef.current = val
                        }}
                        placeholder="Or paste a Figma team URL"
                      />
                    </>
                  )}
                  <span className="field-hint">
                    {active.id === 'figma'
                      ? form.organization
                        ? `Using Figma team ${form.organization}.`
                        : 'Paste a team URL if the list is empty.'
                      : form.organization
                        ? `New repositories will be created in ${form.organization}.`
                        : 'New repositories will be created under your personal account.'}
                  </span>
                </div>
              )}
              {active.id === 'figma' && active.connected && form.organization && form.organization !== '__custom__' && (
                <div className="field-group">
                  <div className="field-label-row">
                    <label htmlFor="figma-project-select">Figma project</label>
                    <button
                      type="button"
                      className="mini-btn"
                      disabled={discoveringProjects}
                      onClick={() => {
                        if (!state.projectId || !form.organization) return
                        setDiscoveringProjects(true)
                        void fetchFigmaProjects({ projectId: state.projectId, organization: form.organization })
                          .then((list) => {
                            setProjects(list)
                            patchItem('figma', { availableProjects: list })
                          })
                          .catch((err) => {
                            setError(err instanceof Error ? err.message : 'Could not fetch Figma projects.')
                          })
                          .finally(() => setDiscoveringProjects(false))
                      }}
                    >
                      <RefreshCw size={11} className={discoveringProjects ? 'spin' : ''} />
                      {discoveringProjects ? 'Loading…' : 'Find projects'}
                    </button>
                  </div>
                  {projects.length > 0 ? (
                    <select
                      id="figma-project-select"
                      value={form.projectKey}
                      onChange={(e) => handleProjectSelect(e.target.value)}
                    >
                      <option value="">-- Choose Figma project --</option>
                      {projects.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="field-hint">No Figma projects listed yet. Find projects after picking a team.</span>
                  )}
                </div>
              )}
              {active.id === 'figma' && active.connected && form.projectKey && (
                <div className="field-group figma-design-bind">
                  <div className="field-label-row">
                    <label htmlFor="figma-file-select">Figma file</label>
                    <button
                      type="button"
                      className="mini-btn"
                      disabled={discoveringFiles}
                      onClick={() => void handleDiscoverFigmaFiles()}
                    >
                      <RefreshCw size={11} className={discoveringFiles ? 'spin' : ''} />
                      {discoveringFiles ? 'Loading…' : 'Find files'}
                    </button>
                  </div>
                  {figmaFiles.length > 0 || (state.figmaDesign?.availableFiles || []).length > 0 ? (
                    <select
                      id="figma-file-select"
                      value={state.figmaDesign?.fileKey || ''}
                      onChange={(e) => handleFigmaFileSelect(e.target.value)}
                    >
                      <option value="">-- Choose design file --</option>
                      {(figmaFiles.length > 0 ? figmaFiles : state.figmaDesign?.availableFiles || []).map((file) => (
                        <option key={file.key} value={file.key}>
                          {file.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="field-hint">Find files after picking a Figma project.</span>
                  )}
                  <label className="figma-sync-toggle">
                    <input
                      type="checkbox"
                      checked={state.figmaDesign?.syncJira !== false}
                      onChange={(e) =>
                        onUpdate({
                          figmaDesign: { ...(state.figmaDesign || {}), syncJira: e.target.checked },
                        })
                      }
                    />
                    Update linked Jira tickets when this file changes
                  </label>
                  <button
                    type="button"
                    className="secondary-btn"
                    disabled={ingestingDesign || !state.figmaDesign?.fileKey}
                    onClick={() => void handleIngestFigma()}
                  >
                    <RefreshCw size={13} className={ingestingDesign ? 'spin' : ''} />
                    {ingestingDesign ? 'Syncing…' : 'Ingest design'}
                  </button>
                  {state.figmaDesign?.lastSyncSummary ? (
                    <span className="field-hint">{state.figmaDesign.lastSyncSummary}</span>
                  ) : (
                    <span className="field-hint">
                      Blink snapshots frames, matches them to stories by name, and comments on Jira when a bound screen changes.
                    </span>
                  )}
                  {state.figmaDesign?.webhookStatus ? (
                    <span className="field-hint">Webhook: {state.figmaDesign.webhookStatus}</span>
                  ) : null}
                  {(state.figmaDesign?.screens || []).length > 0 && (
                    <ul className="figma-screen-list">
                      {state.figmaDesign?.screens?.slice(0, 8).map((screen) => (
                        <li key={screen.nodeId}>
                          <strong>{screen.name}</strong>
                          <span>
                            {screen.jiraKey || screen.storyId || 'unbound'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {(active.id === 'jira' || active.id === 'confluence') && (
                <>
                  <div className="field-group">
                    <label htmlFor="int-site">Cloud site URL</label>
                    <input
                      id="int-site"
                      value={form.baseUrl}
                      onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                      placeholder="https://your-team.atlassian.net"
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="int-email">Atlassian email</label>
                    <input
                      id="int-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="you@company.com"
                    />
                  </div>

                  {active.id === 'jira' && (
                    <div className="field-group">
                      <div className="field-label-row">
                        <label htmlFor="int-project-select">Jira Project</label>
                        {(active.connected || (form.baseUrl && form.email)) && (
                          <button
                            type="button"
                            className="mini-btn"
                            disabled={discoveringProjects}
                            onClick={() => void handleDiscoverProjects()}
                          >
                            <RefreshCw size={11} className={discoveringProjects ? 'spin' : ''} />
                            {discoveringProjects ? 'Loading…' : 'Find projects'}
                          </button>
                        )}
                      </div>

                      {projects.length > 0 && !isCustomProjectKey ? (
                        <>
                          <select
                            id="int-project-select"
                            value={form.projectKey}
                            onChange={(e) => handleProjectSelect(e.target.value)}
                          >
                            <option value="">-- Choose Jira Project --</option>
                            {projects.map((p) => (
                              <option key={p.key} value={p.key}>
                                {p.name} ({p.key})
                              </option>
                            ))}
                            <option value="__custom__">Custom / Enter manually…</option>
                          </select>
                          {selectedProjectName && (
                            <span className="field-hint">
                              Selected: <strong>{selectedProjectName}</strong> ({form.projectKey})
                            </span>
                          )}
                        </>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input
                            id="int-project"
                            value={form.projectKey}
                            onChange={(e) => setForm({ ...form, projectKey: e.target.value.toUpperCase() })}
                            placeholder="e.g. FIT, PROJ, ENG"
                            style={{ flex: 1 }}
                          />
                          {projects.length > 0 && (
                            <button
                              type="button"
                              className="text-btn mini-btn"
                              onClick={() => setIsCustomProjectKey(false)}
                            >
                              Show list
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {active.id === 'jira' && (
                    <div className="field-group atlassian-confluence-block">
                      <label htmlFor="int-space">Confluence space key (optional)</label>
                      <input
                        id="int-space"
                        value={form.spaceKey}
                        onChange={(e) => setForm({ ...form, spaceKey: e.target.value })}
                        placeholder="ENG"
                      />
                      <span className="field-hint">
                        {confluence?.connected
                          ? `Confluence connected${confluence.spaceKey ? ` • ${confluence.spaceKey}` : ''}.`
                          : 'Same Atlassian site as Jira. Paste an API token below to connect Confluence.'}
                      </span>
                    </div>
                  )}
                </>
              )}
              {active.id === 'bitbucket' && (
                <>
                  <div className="field-group">
                    <label htmlFor="int-workspace">Workspace</label>
                    <input
                      id="int-workspace"
                      value={form.workspace}
                      onChange={(e) => setForm({ ...form, workspace: e.target.value })}
                      placeholder="your-workspace"
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="int-user">Username</label>
                    <input
                      id="int-user"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="bitbucket-username"
                    />
                  </div>
                </>
              )}
              <div className="field-group">
                <label htmlFor="int-token">{guide.tokenLabel}</label>
                <input
                  id="int-token"
                  type="password"
                  autoComplete="off"
                  value={form.token}
                  onChange={(e) => setForm({ ...form, token: e.target.value })}
                  placeholder={
                    active.connected ? 'Paste a new token to reconnect' : 'Paste token'
                  }
                />
              </div>
            </div>

            {error && <p className="connect-error">{error}</p>}

            <footer className="connect-modal-actions">
              {active.connected && (
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={saving || oauthLoading}
                  onClick={() => disconnect(active.id)}
                >
                  Disconnect
                </button>
              )}
              <div className="action-spacer" />
              <button
                type="button"
                className="secondary-btn"
                disabled={saving || oauthLoading}
                onClick={() => setActiveId(null)}
              >
                Cancel
              </button>
              {(active.id !== 'github' && active.id !== 'figma') || form.token.trim() ? (
                <button
                  type="button"
                  className="primary-btn"
                  disabled={
                    saving ||
                    oauthLoading ||
                    (!form.token.trim() &&
                      !(active.connected && (form.projectKey.trim() || form.spaceKey.trim() || form.organization.trim())))
                  }
                  onClick={() => void handleConnect()}
                >
                  {saving
                    ? 'Verifying…'
                    : active.connected && !form.token.trim()
                      ? 'Save'
                      : active.id === 'github' || active.id === 'figma'
                        ? 'Connect with token'
                        : 'Connect'}
                </button>
              ) : null}
              {active.id === 'jira' && active.connected && (
                <button
                  type="button"
                  className="oauth-btn"
                  disabled={saving || oauthLoading}
                  onClick={() => void handleStartOAuth()}
                >
                  {oauthLoading ? 'Reconnecting…' : 'Reconnect with Atlassian'}
                </button>
              )}
              {active.id === 'github' && active.connected && (
                <button
                  type="button"
                  className="oauth-btn github"
                  disabled={saving || oauthLoading}
                  onClick={() => void handleStartGithubOAuth()}
                >
                  {oauthLoading ? 'Reconnecting…' : 'Reconnect with GitHub'}
                </button>
              )}
              {active.id === 'figma' && active.connected && (
                <button
                  type="button"
                  className="oauth-btn figma"
                  disabled={saving || oauthLoading}
                  onClick={() => void handleStartFigmaOAuth()}
                >
                  {oauthLoading ? 'Reconnecting…' : 'Reconnect with Figma'}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
