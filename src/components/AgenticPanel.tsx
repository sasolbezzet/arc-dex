import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getAddress } from 'viem'
import { useI18n } from '../i18n'
import {
  approveAndFundJob,
  completeJob,
  createAgenticJob,
  hashTextBytes32,
  readAgent,
  readJob,
  registerAgent,
  setJobBudget,
  submitDeliverable,
  type AgenticJob,
} from '../services/agentic'
import {
  getAgentProfile,
  getStoredJobs,
  saveAgentProfile,
  saveStoredJob,
  type StoredAgentProfile,
  type StoredAgenticJob,
} from '../services/agenticStore'

type Status = { type: 'success' | 'error' | 'info'; msg: string; link?: string }
type View = 'agent' | 'create' | 'manage'
const VIEW_LABEL_KEYS: Record<View, 'agentic.view.agent' | 'agentic.view.create' | 'agentic.view.manage'> = {
  agent: 'agentic.view.agent',
  create: 'agentic.view.create',
  manage: 'agentic.view.manage',
}

interface Props {
  address: string | null
  eoaBalances: Record<string, string>
  onRefresh: () => void
}

function shortAddress(value?: string) {
  if (!value) return '-'
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function StatusBox({ status }: { status: Status | null }) {
  if (!status) return null
  const tone = status.type === 'success'
    ? { bg: 'rgba(16,185,129,0.1)', color: '#10b981', border: 'rgba(16,185,129,0.3)' }
    : status.type === 'info'
      ? { bg: 'rgba(99,102,241,0.1)', color: '#818cf8', border: 'rgba(99,102,241,0.3)' }
      : { bg: 'rgba(239,68,68,0.1)', color: '#f87171', border: 'rgba(239,68,68,0.3)' }
  return (
    <div style={{padding:10,borderRadius:10,fontSize:12,background:tone.bg,color:tone.color,border:`1px solid ${tone.border}`,overflowWrap:'anywhere'}}>
      {status.msg}
      {status.link && <div style={{marginTop:4}}><a href={status.link} target='_blank' rel='noreferrer' style={{color:'#818cf8',fontSize:11}}>Explorer →</a></div>}
    </div>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label style={{color:'#64748b',fontSize:12,display:'block',marginBottom:6}}>{children}</label>
}

export function AgenticPanel({ address, eoaBalances, onRefresh }: Props) {
  const { t } = useI18n()
  const [view, setView] = useState<View>('agent')
  const [loading, setLoading] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [profile, setProfile] = useState<StoredAgentProfile | null>(null)
  const [jobs, setJobs] = useState<StoredAgenticJob[]>([])
  const [metadataUri, setMetadataUri] = useState('ipfs://bafkreibdi6623n3xpf7ymk62ckb4bo75o3qemwkpfvp5i25j66itxvsoei')
  const [agentLookupId, setAgentLookupId] = useState('')
  const [agentLookup, setAgentLookup] = useState<{ owner: string; metadataUri: string } | null>(null)
  const [provider, setProvider] = useState('')
  const [evaluator, setEvaluator] = useState('')
  const [description, setDescription] = useState('ARCOX agentic demo job on Arc Testnet')
  const [expiresInHours, setExpiresInHours] = useState('24')
  const [jobId, setJobId] = useState('')
  const [budget, setBudget] = useState('1')
  const [deliverable, setDeliverable] = useState('deliverable-approved-by-provider')
  const [reason, setReason] = useState('deliverable-approved')
  const [jobInfo, setJobInfo] = useState<AgenticJob | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setProfile(getAgentProfile(address))
      setJobs(getStoredJobs(address))
      if (address) {
        setProvider(prev => prev || address)
        setEvaluator(prev => prev || address)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [address])

  const usdcBalance = useMemo(() => parseFloat(eoaBalances.USDC || '0').toFixed(4), [eoaBalances.USDC])

  const run = async (label: string, action: () => Promise<void>) => {
    setLoading(label)
    setStatus(null)
    try {
      await action()
    } catch (e) {
      setStatus({ type: 'error', msg: e instanceof Error ? e.message : t('agentic.error') })
    }
    setLoading('')
  }

  const requireAddress = () => {
    if (!address) throw new Error(t('swap.connectWalletHint'))
    return getAddress(address)
  }

  const handleRegisterAgent = () => run(t('agentic.registering'), async () => {
    const owner = requireAddress()
    if (!metadataUri.trim()) throw new Error(t('agentic.metadataRequired'))
    if (profile && !window.confirm(t('agentic.registerAgainConfirm'))) return
    const result = await registerAgent(owner, metadataUri.trim())
    const next = { owner, agentId: result.agentId, metadataUri: metadataUri.trim(), txHash: result.hash, createdAt: Date.now() }
    saveAgentProfile(next)
    setProfile(next)
    setStatus({ type: 'success', msg: t('agentic.registered', { id: result.agentId }), link: result.explorerUrl })
  })

  const handleLookupAgent = () => run(t('agentic.reading'), async () => {
    if (!agentLookupId) throw new Error(t('agentic.jobIdRequired'))
    const data = await readAgent(agentLookupId)
    setAgentLookup({ owner: String(data.owner), metadataUri: String(data.metadataUri) })
    setStatus({ type: 'success', msg: t('agentic.agentLoaded') })
  })

  const handleCreateJob = () => run(t('agentic.creatingJob'), async () => {
    const client = requireAddress()
    if (!description.trim()) throw new Error(t('agentic.descriptionRequired'))
    const result = await createAgenticJob({
      account: client,
      provider,
      evaluator,
      description: description.trim(),
      expiresInHours: Number(expiresInHours) || 24,
    })
    const stored = {
      id: result.jobId,
      role: 'client' as const,
      description: description.trim(),
      client,
      provider: getAddress(provider),
      evaluator: getAddress(evaluator),
      txHash: result.hash,
      updatedAt: Date.now(),
    }
    saveStoredJob(stored)
    setJobs(getStoredJobs(client))
    setJobId(result.jobId)
    setView('manage')
    setStatus({ type: 'success', msg: t('agentic.jobCreated', { id: result.jobId }), link: result.explorerUrl })
  })

  const handleReadJob = () => run(t('agentic.reading'), async () => {
    if (!jobId) throw new Error(t('agentic.jobIdRequired'))
    const data = await readJob(jobId)
    setJobInfo(data)
    setBudget(data.budget === '0' ? budget : data.budget)
    setStatus({ type: 'success', msg: t('agentic.jobLoaded', { id: data.id }) })
  })

  const handleSetBudget = () => run(t('agentic.settingBudget'), async () => {
    const account = requireAddress()
    if (!jobId || !budget) throw new Error(t('agentic.jobBudgetRequired'))
    const result = await setJobBudget(account, jobId, budget)
    await handleReadJob()
    setStatus({ type: 'success', msg: t('agentic.budgetSet'), link: result.explorerUrl })
  })

  const handleFund = () => run(t('agentic.funding'), async () => {
    const account = requireAddress()
    if (!jobId || !budget) throw new Error(t('agentic.jobBudgetRequired'))
    const result = await approveAndFundJob(account, jobId, budget)
    await handleReadJob()
    onRefresh()
    setStatus({ type: 'success', msg: t('agentic.funded'), link: result.explorerUrl })
  })

  const handleSubmit = () => run(t('agentic.submitting'), async () => {
    const account = requireAddress()
    if (!jobId || !deliverable) throw new Error(t('agentic.deliverableRequired'))
    const result = await submitDeliverable(account, jobId, deliverable)
    await handleReadJob()
    setStatus({ type: 'success', msg: t('agentic.submitted', { hash: result.deliverableHash.slice(0, 10) }), link: result.explorerUrl })
  })

  const handleComplete = () => run(t('agentic.completing'), async () => {
    const account = requireAddress()
    if (!jobId) throw new Error(t('agentic.jobIdRequired'))
    const result = await completeJob(account, jobId, reason)
    await handleReadJob()
    onRefresh()
    setStatus({ type: 'success', msg: t('agentic.completed'), link: result.explorerUrl })
  })

  const busy = Boolean(loading)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:10}}>
          <span style={{color:'#64748b'}}>{t('agentic.network')}</span>
          <span>Arc Testnet · ERC-8004 / ERC-8183</span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',gap:10,marginTop:4}}>
          <span style={{color:'#64748b'}}>{t('agentic.signer')}</span>
          <span style={{fontFamily:'monospace',color:'#f59e0b'}}>{shortAddress(address || '')}</span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',gap:10,marginTop:4}}>
          <span style={{color:'#64748b'}}>E-USDC</span>
          <span style={{color:'#10b981'}}>{usdcBalance}</span>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
        {(['agent', 'create', 'manage'] as View[]).map(item => (
          <button key={item} onClick={()=>setView(item)} style={{padding:'9px 6px',borderRadius:8,cursor:'pointer',border:view===item?'1px solid rgba(99,102,241,0.65)':'1px solid #1e1e2e',background:view===item?'rgba(99,102,241,0.14)':'rgba(18,18,26,0.8)',color:view===item?'#c7d2fe':'#64748b',fontSize:12,fontWeight:600}}>
            {t(VIEW_LABEL_KEYS[item])}
          </button>
        ))}
      </div>

      {view === 'agent' && (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <div className='glass' style={{padding:12,borderRadius:10}}>
            <div style={{color:'#e2e8f0',fontWeight:700,fontSize:13,marginBottom:4}}>{t('agentic.identity')}</div>
            <div style={{color:'#64748b',fontSize:11,marginBottom:10}}>{t('agentic.identityHelp')}</div>
            {profile && (
              <div style={{fontSize:12,marginBottom:10,display:'grid',gap:4}}>
                <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{color:'#64748b'}}>Agent ID</span><span style={{color:'#818cf8'}}>{profile.agentId}</span></div>
                <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{color:'#64748b'}}>Owner</span><span style={{fontFamily:'monospace'}}>{shortAddress(profile.owner)}</span></div>
              </div>
            )}
            <FieldLabel>{t('agentic.metadataUri')}</FieldLabel>
            <input className='input' value={metadataUri} onChange={e=>setMetadataUri(e.target.value)} placeholder='ipfs://...' style={{fontSize:12,fontFamily:'monospace'}} />
            <button className='btn btn-primary' disabled={busy || !address || !metadataUri} onClick={handleRegisterAgent} style={{marginTop:10}}>
              {loading === t('agentic.registering') ? `... ${loading}` : t('agentic.register')}
            </button>
          </div>

          <div className='glass' style={{padding:12,borderRadius:10}}>
            <FieldLabel>{t('agentic.lookupAgent')}</FieldLabel>
            <div style={{display:'flex',gap:8}}>
              <input className='input' value={agentLookupId} onChange={e=>setAgentLookupId(e.target.value)} placeholder='Agent ID' />
              <button className='btn btn-primary' disabled={busy || !agentLookupId} onClick={handleLookupAgent} style={{width:96}}>{t('common.refresh')}</button>
            </div>
            {agentLookup && (
              <div style={{fontSize:12,marginTop:10,display:'grid',gap:4}}>
                <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{color:'#64748b'}}>Owner</span><span style={{fontFamily:'monospace'}}>{shortAddress(agentLookup.owner)}</span></div>
                <div style={{color:'#64748b',overflowWrap:'anywhere'}}>{agentLookup.metadataUri}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {view === 'create' && (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <div>
            <FieldLabel>{t('agentic.provider')}</FieldLabel>
            <input className='input' value={provider} onChange={e=>setProvider(e.target.value)} placeholder='0x...' style={{fontSize:12,fontFamily:'monospace'}} />
          </div>
          <div>
            <FieldLabel>{t('agentic.evaluator')}</FieldLabel>
            <input className='input' value={evaluator} onChange={e=>setEvaluator(e.target.value)} placeholder='0x...' style={{fontSize:12,fontFamily:'monospace'}} />
          </div>
          <div>
            <FieldLabel>{t('agentic.description')}</FieldLabel>
            <textarea className='input' value={description} onChange={e=>setDescription(e.target.value)} rows={3} />
          </div>
          <div>
            <FieldLabel>{t('agentic.expires')}</FieldLabel>
            <input className='input' type='number' value={expiresInHours} onChange={e=>setExpiresInHours(e.target.value)} />
          </div>
          <button className='btn btn-primary' disabled={busy || !address || !provider || !evaluator || !description} onClick={handleCreateJob}>
            {loading === t('agentic.creatingJob') ? `... ${loading}` : t('agentic.createJob')}
          </button>
        </div>
      )}

      {view === 'manage' && (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {jobs.length > 0 && (
            <div style={{display:'flex',gap:6,overflowX:'auto',paddingBottom:2}}>
              {jobs.map(item => (
                <button key={item.id} onClick={()=>setJobId(item.id)} style={{flex:'0 0 auto',padding:'6px 9px',borderRadius:8,border:'1px solid rgba(99,102,241,0.25)',background:item.id===jobId?'rgba(99,102,241,0.18)':'rgba(18,18,26,0.8)',color:item.id===jobId?'#c7d2fe':'#64748b',fontSize:11,cursor:'pointer'}}>
                  #{item.id}
                </button>
              ))}
            </div>
          )}
          <div>
            <FieldLabel>{t('agentic.jobId')}</FieldLabel>
            <div style={{display:'flex',gap:8}}>
              <input className='input' value={jobId} onChange={e=>setJobId(e.target.value)} placeholder='Job ID' />
              <button className='btn btn-primary' disabled={busy || !jobId} onClick={handleReadJob} style={{width:96}}>{t('common.refresh')}</button>
            </div>
          </div>
          {jobInfo && (
            <div className='glass' style={{padding:12,borderRadius:10,fontSize:12,display:'grid',gap:5}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{color:'#64748b'}}>Status</span><span style={{color:'#10b981'}}>{jobInfo.status}</span></div>
              <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{color:'#64748b'}}>Budget</span><span>{jobInfo.budget} USDC</span></div>
              <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{color:'#64748b'}}>Client</span><span style={{fontFamily:'monospace'}}>{shortAddress(jobInfo.client)}</span></div>
              <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{color:'#64748b'}}>Provider</span><span style={{fontFamily:'monospace'}}>{shortAddress(jobInfo.provider)}</span></div>
              <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{color:'#64748b'}}>Evaluator</span><span style={{fontFamily:'monospace'}}>{shortAddress(jobInfo.evaluator)}</span></div>
              <div style={{color:'#94a3b8',overflowWrap:'anywhere'}}>{jobInfo.description}</div>
            </div>
          )}
          <div className='glass' style={{padding:12,borderRadius:10,display:'grid',gap:10}}>
            <div>
              <FieldLabel>{t('agentic.budget')}</FieldLabel>
              <input className='input' type='number' value={budget} onChange={e=>setBudget(e.target.value)} />
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <button className='btn btn-primary' disabled={busy || !jobId || !budget} onClick={handleSetBudget}>{t('agentic.setBudget')}</button>
              <button className='btn btn-primary' disabled={busy || !jobId || !budget} onClick={handleFund}>{t('agentic.fundEscrow')}</button>
            </div>
          </div>
          <div>
            <FieldLabel>{t('agentic.deliverable')}</FieldLabel>
            <textarea className='input' rows={2} value={deliverable} onChange={e=>setDeliverable(e.target.value)} />
            <div style={{fontSize:10,color:'#64748b',marginTop:4,overflowWrap:'anywhere'}}>bytes32: {hashTextBytes32(deliverable).slice(0, 18)}...</div>
            <button className='btn btn-primary' disabled={busy || !jobId || !deliverable} onClick={handleSubmit} style={{marginTop:8}}>{t('agentic.submit')}</button>
          </div>
          <div>
            <FieldLabel>{t('agentic.reason')}</FieldLabel>
            <input className='input' value={reason} onChange={e=>setReason(e.target.value)} />
            <button className='btn btn-primary' disabled={busy || !jobId} onClick={handleComplete} style={{marginTop:8}}>{t('agentic.complete')}</button>
          </div>
        </div>
      )}

      <StatusBox status={status || (loading ? { type:'info', msg: loading } : null)} />
      <div style={{fontSize:11,color:'#64748b',textAlign:'center'}}>{t('agentic.help')}</div>
    </div>
  )
}
