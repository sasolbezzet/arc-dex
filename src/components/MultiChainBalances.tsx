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
const CHAIN_ACCENTS: Record<string, string> = {
  'arc-testnet': '#38bdf8',
  'ethereum-sepolia': '#818cf8',
  'arbitrum-sepolia': '#a78bfa',
  'base-sepolia': '#60a5fa',
}
const TOKENS = ['USDC', 'ETH', 'EURC', 'cirBTC'] as const

type ChainKey = typeof CHAIN_KEYS[number]
type Token = typeof TOKENS[number]

interface Balance {
  [chainKey: string]: {
    [token: string]: string
  }
}

interface Props {
  walletAddress: string
}

function normalizeDecimal(value: string | undefined) {
  const raw = String(value || '0').replace(/,/g, '').trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return '0'
  const negative = raw.startsWith('-')
  const unsigned = negative ? raw.slice(1) : raw
  let [integer, fraction = ''] = unsigned.split('.')
  integer = integer.replace(/^0+(?=\d)/, '') || '0'
  fraction = fraction.replace(/0+$/, '')
  return `${negative && (integer !== '0' || fraction) ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`
}

function addDecimals(left: string | undefined, right: string | undefined) {
  const a = normalizeDecimal(left)
  const b = normalizeDecimal(right)
  const aNegative = a.startsWith('-')
  const bNegative = b.startsWith('-')
  const aUnsigned = aNegative ? a.slice(1) : a
  const bUnsigned = bNegative ? b.slice(1) : b
  const [aInteger, aFraction = ''] = aUnsigned.split('.')
  const [bInteger, bFraction = ''] = bUnsigned.split('.')
  const places = Math.max(aFraction.length, bFraction.length)
  const scale = 10n ** BigInt(places)
  const aScaled = (BigInt(aInteger) * scale + BigInt(aFraction.padEnd(places, '0') || '0')) * (aNegative ? -1n : 1n)
  const bScaled = (BigInt(bInteger) * scale + BigInt(bFraction.padEnd(places, '0') || '0')) * (bNegative ? -1n : 1n)
  const total = aScaled + bScaled
  const negative = total < 0n
  const absolute = negative ? -total : total
  const integer = absolute / scale
  const fraction = places === 0 ? '' : absolute.toString().slice(-places).padStart(places, '0').replace(/0+$/, '')
  return normalizeDecimal(`${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`)
}

function formatBalance(value: string | undefined, token: Token, compact = false) {
  const normalized = normalizeDecimal(value)
  const negative = normalized.startsWith('-')
  const unsigned = negative ? normalized.slice(1) : normalized
  let [integer, fraction = ''] = unsigned.split('.')
  const maximumFractionDigits = token === 'ETH' ? 6 : 2
  const fractionDigits = compact ? maximumFractionDigits : Math.max(maximumFractionDigits, 6)
  fraction = fraction.slice(0, fractionDigits).replace(/0+$/, '')
  integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`
}

function shortAddress(address: string) {
  if (address.length <= 18) return address
  return `${address.slice(0, 10)}…${address.slice(-8)}`
}

export function MultiChainBalances({ walletAddress }: Props) {
  const [balances, setBalances] = useState<Balance>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [activeChain, setActiveChain] = useState<ChainKey>('arc-testnet')

  const fetchBalances = useCallback(async () => {
    if (!walletAddress) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/multi-balance/${walletAddress}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Gagal memuat balance')
      if (data.balances) setBalances(data.balances)
    } catch (e: any) {
      setError(e?.message || 'Gagal memuat balance')
    } finally {
      setLoading(false)
    }
  }, [walletAddress])

  useEffect(() => { fetchBalances() }, [fetchBalances])

  useEffect(() => {
    const interval = setInterval(fetchBalances, 30000)
    return () => clearInterval(interval)
  }, [fetchBalances])

  const totalByToken: Record<string, string> = {}
  for (const token of TOKENS) {
    totalByToken[token] = '0'
    for (const chainKey of CHAIN_KEYS) {
      totalByToken[token] = addDecimals(totalByToken[token], balances[chainKey]?.[token])
    }
  }

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Address tidak dapat disalin dari browser ini.')
    }
  }

  const activeAccent = CHAIN_ACCENTS[activeChain]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, marginBottom: 4 }}>
      {/* Wallet identity */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        minWidth: 0, padding: '12px 14px', borderRadius: 12,
        background: 'linear-gradient(135deg, rgba(15,23,42,0.88), rgba(30,41,59,0.58))',
        border: '1px solid rgba(99,102,241,0.24)',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#94a3b8', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>
            Agent Wallet · MSCA
          </div>
          <code title={walletAddress} style={{ display: 'block', color: '#e2e8f0', fontSize: 12, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {shortAddress(walletAddress)}
          </code>
        </div>
        <button
          type='button'
          onClick={copyAddress}
          title='Copy Agent Wallet address'
          aria-label='Copy Agent Wallet address'
          style={{
            flex: '0 0 auto', padding: '7px 10px', borderRadius: 8,
            border: '1px solid rgba(148,163,184,0.22)', background: 'rgba(15,23,42,0.66)',
            color: copied ? '#4ade80' : '#cbd5e1', fontSize: 11, cursor: 'pointer',
          }}
        >
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>

      {/* Aggregated totals */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
          <span style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 650 }}>Total across networks</span>
          <span style={{ color: '#64748b', fontSize: 10 }}>USDC · ETH · EURC · cirBTC</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(116px, 1fr))', gap: 8 }}>
          {TOKENS.map(token => (
            <div key={token} style={{ minWidth: 0, padding: '11px 12px', borderRadius: 10, background: 'rgba(15,23,42,0.62)', border: '1px solid rgba(51,65,85,0.8)' }}>
              <div style={{ color: '#64748b', fontSize: 10, marginBottom: 5 }}>{token}</div>
              <div title={totalByToken[token]} style={{ color: '#f8fafc', fontSize: 15, fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {formatBalance(totalByToken[token], token, true)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Network selector */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
          <span style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 650 }}>Network balances</span>
          <button
            type='button'
            onClick={fetchBalances}
            disabled={loading}
            aria-label='Refresh balances'
            style={{ padding: '5px 9px', borderRadius: 7, border: '1px solid rgba(51,65,85,0.9)', background: 'rgba(15,23,42,0.7)', color: loading ? '#475569' : '#94a3b8', fontSize: 11, cursor: loading ? 'wait' : 'pointer' }}
          >
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 7 }}>
          {CHAIN_KEYS.map(key => {
            const selected = activeChain === key
            const accent = CHAIN_ACCENTS[key]
            return (
              <button
                type='button'
                key={key}
                onClick={() => setActiveChain(key)}
                aria-pressed={selected}
                style={{
                  minWidth: 0, textAlign: 'left', padding: '10px 11px', borderRadius: 10,
                  border: `1px solid ${selected ? `${accent}99` : 'rgba(51,65,85,0.82)'}`,
                  background: selected ? `linear-gradient(135deg, ${accent}20, rgba(15,23,42,0.82))` : 'rgba(15,23,42,0.52)',
                  boxShadow: selected ? `0 0 0 1px ${accent}18` : 'none', cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <span aria-hidden='true'>{CHAIN_ICONS[key]}</span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? '#f8fafc' : '#cbd5e1', fontSize: 11, fontWeight: 650 }}>
                    {CHAIN_NAMES[key]}
                  </span>
                </div>
                <div style={{ color: selected ? accent : '#64748b', fontSize: 10, marginTop: 5 }}>
                  {selected ? 'Selected' : 'View balance'}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected network detail */}
      <div style={{ minWidth: 0, padding: 13, borderRadius: 12, background: 'rgba(15,23,42,0.48)', border: `1px solid ${activeAccent}45` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16 }} aria-hidden='true'>{CHAIN_ICONS[activeChain]}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#f8fafc', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{CHAIN_NAMES[activeChain]}</div>
              <div style={{ color: '#64748b', fontSize: 10 }}>Available assets</div>
            </div>
          </div>
          {loading && <span style={{ color: activeAccent, fontSize: 10, whiteSpace: 'nowrap' }}>Updating…</span>}
        </div>
        {error && (
          <div role='alert' style={{ marginBottom: 9, padding: '8px 10px', borderRadius: 8, color: '#fca5a5', background: 'rgba(127,29,29,0.22)', border: '1px solid rgba(248,113,113,0.24)', fontSize: 11, lineHeight: 1.35 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 7 }}>
          {TOKENS.map(token => (
            <div key={token} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0, padding: '9px 10px', borderRadius: 8, background: 'rgba(30,41,59,0.55)' }}>
              <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>{token}</span>
              <span title={balances[activeChain]?.[token] || '0'} style={{ minWidth: 0, color: '#f8fafc', fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {formatBalance(balances[activeChain]?.[token], token)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
