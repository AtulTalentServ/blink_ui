export interface StakeholderRoleDef {
  id: string
  label: string
  defaultName?: string
  defaultEmail?: string
}

/** Local copy of blink-backend/src/main/resources/stakeholders.yaml (used if the API is unreachable). */
export const STAKEHOLDER_ROLES: StakeholderRoleDef[] = [
  { id: 'product_owner', label: 'Product Owner' },
  { id: 'business_analyst', label: 'Business Analyst' },
  { id: 'ux_designer', label: 'UX Designer', defaultName: 'Riya Bajpai', defaultEmail: 'riya.bajpai@talentserv.co.in' },
  { id: 'platform_architect', label: 'Platform Architect' },
  { id: 'tech_lead', label: 'Tech Lead' },
  { id: 'backend_developer', label: 'Backend Developer', defaultName: 'Nisha Dhore', defaultEmail: 'nisha.dhore@talentserv.co.in' },
  { id: 'frontend_developer', label: 'Frontend Developer', defaultName: 'Pradnya Gajarmal', defaultEmail: 'pradnya.gajarmal@talentserv.co.in' },
  { id: 'dba', label: 'DBA', defaultName: 'Ashwin Kumar', defaultEmail: 'ashwin.kumar@talentserv.co.in' },
  { id: 'sre', label: 'SRE' },
  { id: 'qa_lead', label: 'QA Lead' },
  { id: 'qa_engineer', label: 'QA Engineer' },
  { id: 'security_champion', label: 'Security Champion', defaultName: 'Riya Bajpai', defaultEmail: 'riya.bajpai@talentserv.co.in' },
  { id: 'compliance_approver', label: 'Compliance Approver' },
  { id: 'release_approver', label: 'Release Approver' },
]

export function assignmentsFromRoles(roles: StakeholderRoleDef[]) {
  return roles.map((role) => ({
    id: `sa-${role.id}`,
    roleId: role.id,
    personName: role.defaultName ?? '',
    personEmail: role.defaultEmail ?? '',
  }))
}

export interface PersonRecord {
  id: string
  name: string
  email: string
}

const uniquePeople = new Map<string, PersonRecord>()
for (const role of STAKEHOLDER_ROLES) {
  const email = role.defaultEmail?.toLowerCase()
  if (!email || uniquePeople.has(email)) continue
  uniquePeople.set(email, { id: email, name: role.defaultName ?? '', email: role.defaultEmail ?? '' })
}

export const SAMPLE_PEOPLE: PersonRecord[] = [...uniquePeople.values()]

export function searchPeople(query: string): PersonRecord[] {
  const q = query.trim().toLowerCase()
  if (!q) return SAMPLE_PEOPLE
  return SAMPLE_PEOPLE.filter(
    (p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
  )
}

export function roleLabel(roleId: string): string {
  return STAKEHOLDER_ROLES.find((r) => r.id === roleId)?.label ?? roleId.replaceAll('_', ' ')
}
