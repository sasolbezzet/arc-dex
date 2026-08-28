// AgentWalletList.tsx — "1 wallet = 1 agent" wallet overview.
// One compact row per Agent Wallet: whose wallet it is, its address, and a
// single balance line underneath. Deliberately space-efficient: the full
// multi-chain dashboard stays in MultiChainBalances.
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'

export interface AgentWalletEntry {
  address: string
  label: string
  live?: boolean
}

const API = ''

function shortAddress(address: string) {
  return address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address
}

function sumToken(balances: Record<string, any> | undefined, token: string) {
  let total = 0
  for (const chain of Object.values(balances || {})) {
    const value = Number(String((chain as any)?.[token] ?? '0').replace(/,/g, ''))
    if (Number.isFinite(value)) total += value
  }
  // Compact display: never show more than 4 decimals.
  return total.toFixed(total > 0 && total < 0.01 ? 4 : 2).replace(/\.?0+$/, m => (m.includes('.') ? '' : m))
}

function BalanceLine({ address }: { address: string }) {
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
        const arc = data?.balances?.['arc-testnet']
        const nativeSymbol = String(arc?.nativeSymbol || '')
        const native = Number(String(arc?.nativeBalance ?? '0').replace(/,/g, ''))
        const parts = [`${usdc} USDC`]
        if (nativeSymbol && nativeSymbol !== 'USDC' && Number.isFinite(native) && native > 0) parts.push(`${native.toFixed(4).replace(/\.?0+$/, m => (m.includes('.') ? '' : m))} ${nativeSymbol}`)
        setText(parts.join(' · '))
      } catch {
        if (!cancelled) setText(t('plugin.walletBalanceUnavailable'))
      }
    }
    void load()
    const interval = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [address, t])
  if (!text) return <span style={{ color: '#475569', fontSize: 10 }}>…</span>
  return <span style={{ color: '#86efac', fontSize: 10 }}>{text}</span>
}

export function AgentWalletList({ wallets }: { wallets: AgentWalletEntry[] }) {
  const { t } = useI18n()
  if (wallets.length === 0) return null
  return (
    <div style={{ padding: '8px 10px', background: 'rgba(18,18,26,0.55)', borderRadius: 8, marginBottom: 10 }}>
      <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>{t('plugin.agentWalletListTitle')}</div>
      {wallets.map(wallet => (
        <div key={wallet.address} style={{ padding: '6px 0', borderTop: wallets[0].address === wallet.address ? 'none' : '1px solid rgba(30,30,46,0.7)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {wallet.live ? <span title={t('plugin.agentStatusConnected')} style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} /> : <span title={t('plugin.idle')} style={{ width: 7, height: 7, borderRadius: '50%', background: '#64748b', flexShrink: 0 }} />}
              <span style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{wallet.label}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#94a3b8' }}>{shortAddress(wallet.address)}</span>
              <span role='button' aria-label={t('plugin.copyWalletAddress')} onClick={() => navigator.clipboard?.writeText(wallet.address).catch(() => {})} style={{ cursor: 'pointer', fontSize: 10, opacity: 0.75 }}>📋</span>
            </span>
          </div>
          <div style={{ paddingLeft: 13, marginTop: 1 }}>
            <BalanceLine address={wallet.address} />
          </div>
        </div>
      ))}
      <div style={{ color: '#475569', fontSize: 9, marginTop: 4 }}>{t('plugin.agentWalletListNote')}</div>
    </div>
  )
}
