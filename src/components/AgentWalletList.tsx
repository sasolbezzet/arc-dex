// AgentWalletList.tsx — "1 wallet = 1 agent" compact wallet overview.
// One single row per Agent Wallet: status dot · label · short address · balance.
// Minimal vertical footprint — the full multi-chain dashboard stays in MultiChainBalances.
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'

export interface AgentWalletEntry {
  address: string
  label: string
  live?: boolean
}

const API = ''

function shortAddress(address: string) {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

function sumToken(balances: Record<string, any> | undefined, token: string) {
  let total = 0
  for (const chain of Object.values(balances || {})) {
    const value = Number(String((chain as any)?.[token] ?? '0').replace(/,/g, ''))
    if (Number.isFinite(value)) total += value
  }
  return total.toFixed(total > 0 && total < 0.01 ? 4 : 2).replace(/\.?0+$/, m => (m.includes('.') ? '' : m))
}

function BalanceText({ address }: { address: string }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`${API}/api/multi-balance/${address}`)
        if (!res.ok) throw new Error('balance_failed')
        const data = await res.json()
        if (cancelled) return
        const usdc = sumToken(data?.balances, 'USDC')
        setText(usdc ? `${usdc} USDC` : '')
      } catch {
        if (!cancelled) setText('—')
      }
    }
    void load()
    const interval = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [address, t])
  if (!text) return <span style={{ color: '#475569', fontSize: 9 }}>…</span>
  return <span style={{ color: '#86efac', fontSize: 9 }}>{text}</span>
}

export function AgentWalletList({ wallets }: { wallets: AgentWalletEntry[] }) {
  const { t } = useI18n()
  if (wallets.length === 0) return null
  return (
    <div style={{ padding: '6px 8px', background: 'rgba(18,18,26,0.5)', borderRadius: 6, marginBottom: 8 }}>
      <div style={{ color: '#94a3b8', fontSize: 9, marginBottom: 3 }}>{t('plugin.agentWalletListTitle')}</div>
      {wallets.map(wallet => (
        <div key={wallet.address} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0',
          borderTop: wallets[0].address === wallet.address ? 'none' : '1px solid rgba(30,30,46,0.5)',
        }}>
          {/* status dot */}
          {wallet.live
            ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
            : <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#64748b', flexShrink: 0 }} />}
          {/* agent label */}
          <span style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', minWidth: 42 }}>{wallet.label}</span>
          {/* address */}
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#64748b', flexShrink: 0 }}>{shortAddress(wallet.address)}</span>
          {/* copy button */}
          <span role='button' aria-label={t('plugin.copyWalletAddress')} onClick={() => navigator.clipboard?.writeText(wallet.address).catch(() => {})} style={{ cursor: 'pointer', fontSize: 9, opacity: 0.6, flexShrink: 0 }}>📋</span>
          {/* balance — right aligned, fills remaining space */}
          <span style={{ marginLeft: 'auto' }}><BalanceText address={wallet.address} /></span>
        </div>
      ))}
    </div>
  )
}
