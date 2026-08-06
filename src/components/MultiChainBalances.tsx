// MultiChainBalances.tsx — Balance dashboard across all 4 chains for Agent Wallet.
import { useState, useEffect, useCallback } from 'react'

const API = ''
const CHAIN_KEYS = ['arc-testnet', 'ethereum-sepolia', 'arbitrum-sepolia', 'base-sepolia'] as const
const CHAIN_NAMES: Record<string, string> = {
  'arc-testnet': 'Arc Testnet',
  'ethereum-sepolia': 'Ethereum Sepolia',
  'arbitrum-sepolia': 'Arbitrum Sepolia',
  'base-sepolia': 'Base Sepolia',
}
const CHAIN_ICONS: Record<string, string> = {
  'arc-testnet': '🔵',
  'ethereum-sepolia': '🔷',
  'arbitrum-sepolia': '🟣',
  'base-sepolia': '🔵',
}
const TOKENS = ['USDC', 'ETH', 'EURC', 'cirBTC'] as const

interface Balance {
  [chainKey: string]: {
    [token: string]: string
  }
}

interface Props {
  walletAddress: string
}

export function MultiChainBalances({ walletAddress }: Props) {
  const [balances, setBalances] = useState<Balance>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeChain, setActiveChain] = useState<string>('arc-testnet')

  const fetchBalances = useCallback(async () => {
    if (!walletAddress) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/multi-balance/${walletAddress}`)
      const data = await res.json()
      if (data.balances) setBalances(data.balances)
    } catch (e: any) {
      setError(e?.message || 'Gagal memuat balance')
    } finally {
      setLoading(false)
    }
  }, [walletAddress])

  useEffect(() => { fetchBalances() }, [fetchBalances])

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchBalances, 30000)
    return () => clearInterval(interval)
  }, [fetchBalances])

  const totalByToken: Record<string, number> = {}
  for (const chainKey of CHAIN_KEYS) {
    for (const token of TOKENS) {
      const val = parseFloat(balances[chainKey]?.[token] || '0')
      totalByToken[token] = (totalByToken[token] || 0) + val
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Total summary */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {TOKENS.map(token => (
          <div key={token} style={{ background: 'rgba(30,30,46,0.6)', borderRadius: 8, padding: '6px 12px', border: '1px solid #334155' }}>
            <div style={{ fontSize: 10, color: '#64748b' }}>Total {token}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>
              {(totalByToken[token] || 0).toFixed(token === 'ETH' ? 6 : 2)}
            </div>
          </div>
        ))}
      </div>

      {/* Chain tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, overflowX: 'auto' }}>
        {CHAIN_KEYS.map(key => (
          <button
            key={key}
            onClick={() => setActiveChain(key)}
            style={{
              background: activeChain === key ? 'rgba(99,102,241,0.2)' : 'transparent',
              border: `1px solid ${activeChain === key ? '#6366f1' : '#334155'}`,
              borderRadius: 6,
              padding: '4px 10px',
              color: activeChain === key ? '#a5b4fc' : '#94a3b8',
              cursor: 'pointer',
              fontSize: 11,
              whiteSpace: 'nowrap',
            }}
          >
            {CHAIN_ICONS[key]} {CHAIN_NAMES[key]}
          </button>
        ))}
        <button
          onClick={fetchBalances}
          disabled={loading}
          style={{
            background: 'transparent',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '4px 10px',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          {loading ? '...' : '↻'}
        </button>
      </div>

      {/* Active chain balances */}
      <div style={{ background: 'rgba(15,15,25,0.4)', borderRadius: 8, border: '1px solid #1e293b', padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>
          {CHAIN_ICONS[activeChain]} {CHAIN_NAMES[activeChain]}
        </div>
        {error && <div style={{ color: '#f87171', fontSize: 11 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {TOKENS.map(token => (
            <div key={token} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(30,30,46,0.5)', borderRadius: 4 }}>
              <span style={{ color: '#94a3b8', fontSize: 11 }}>{token}</span>
              <span style={{ color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }}>
                {balances[activeChain]?.[token] || '0'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
