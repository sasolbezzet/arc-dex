import { getAddress, isAddress } from 'viem'

export type StoredAgentProfile = {
  owner: string
  agentId: string
  metadataUri: string
  txHash?: string
  createdAt: number
}

export type StoredAgenticJob = {
  id: string
  role: 'client' | 'provider' | 'evaluator'
  client: string
  description: string
  provider: string
  evaluator: string
  txHash?: string
  updatedAt: number
}

export type StoredAgentLink = {
  agentId: string
  owner: string
  metadataUri: string
  aiName: string
  endpoint: string
  capabilities: string[]
  handshakeMessage: string
  ownerSignature: string
  metadataJson: string
  linkedAt: number
}

const AGENTS_KEY = 'arcox-agentic-agents'
const JOBS_KEY = 'arcox-agentic-jobs'
const LINKS_KEY = 'arcox-agentic-ai-links'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function getAgentProfile(owner: string | null): StoredAgentProfile | null {
  if (!owner) return null
  const profiles = readJson<StoredAgentProfile[]>(AGENTS_KEY, [])
  return profiles.find(item => item.owner.toLowerCase() === owner.toLowerCase()) ?? null
}

export function saveAgentProfile(profile: StoredAgentProfile) {
  const profiles = readJson<StoredAgentProfile[]>(AGENTS_KEY, [])
  const next = [profile, ...profiles.filter(item => item.owner.toLowerCase() !== profile.owner.toLowerCase())].slice(0, 20)
  writeJson(AGENTS_KEY, next)
}

export function getStoredJobs(owner: string | null): StoredAgenticJob[] {
  if (!owner) return []
  const addr = owner.toLowerCase()
  return readJson<StoredAgenticJob[]>(JOBS_KEY, [])
    .filter(item => item.client.toLowerCase() === addr || item.provider.toLowerCase() === addr || item.evaluator.toLowerCase() === addr)
    .slice(0, 20)
}

export function saveStoredJob(job: StoredAgenticJob) {
  const jobs = readJson<StoredAgenticJob[]>(JOBS_KEY, [])
  const next = [job, ...jobs.filter(item => item.id !== job.id)].slice(0, 50)
  writeJson(JOBS_KEY, next)
}

export function getAgentLink(owner: string | null): StoredAgentLink | null {
  if (!owner) return null
  if (!isAddress(owner)) return null
  const normalizedOwner = getAddress(owner)
  const links = readJson<StoredAgentLink[]>(LINKS_KEY, [])
  return links.find(item => isValidAgentLink(item) && getAddress(item.owner).toLowerCase() === normalizedOwner.toLowerCase()) ?? null
}

export function saveAgentLink(link: StoredAgentLink) {
  if (!isValidAgentLink(link)) throw new Error('Invalid agent link data')
  const links = readJson<StoredAgentLink[]>(LINKS_KEY, [])
  const next = [link, ...links.filter(item => isValidAgentLink(item) && item.agentId !== link.agentId && getAddress(item.owner).toLowerCase() !== getAddress(link.owner).toLowerCase())].slice(0, 20)
  writeJson(LINKS_KEY, next)
}

function isValidAgentLink(value: unknown): value is StoredAgentLink {
  if (!value || typeof value !== 'object') return false
  const item = value as StoredAgentLink
  if (!item.agentId || !/^\d+$/.test(String(item.agentId))) return false
  if (!isAddress(item.owner)) return false
  if (!item.ownerSignature || !/^0x[0-9a-f]+$/i.test(item.ownerSignature)) return false
  if (!item.handshakeMessage || !item.handshakeMessage.includes(`Agent ID: ${item.agentId}`)) return false
  if (typeof item.endpoint !== 'string' || !item.endpoint.trim()) return false
  try {
    const url = new URL(item.endpoint, window.location.origin)
    if (!['http:', 'https:'].includes(url.protocol)) return false
  } catch {
    return false
  }
  return true
}
