export type TxRecord = {
  id: string
  ts: number
  action?: 'bridge' | 'swap' | 'send'
  source?: 'web-ui' | 'agent-mcp' | string
  walletSource?: 'circle' | 'eoa' | string
  from: ChainName
  to: ChainName
  amount: string
  token?: string
  status: 'pending' | 'success' | 'error'
  tx?: string
  explorer?: string
  approveTx?: string
  burnTx?: string
  burnExplorerUrl?: string
  mintTx?: string
  mintExplorerUrl?: string
  srcDomain?: number
  dstDomain?: number
  error?: string
  note?: string
}

type ChainName = string

const KEY = 'arc-dex.tx-history.v1'
const MAX_ITEMS = 100

function read(): TxRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as TxRecord[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function write(items: TxRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)))
    window.dispatchEvent(new CustomEvent('arc-dex.tx-history'))
  } catch {
    /* ignore quota */
  }
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('arc-dex-auth')
  try {
    const authToken = token ? JSON.parse(token)?.token || '' : ''
    return authToken ? { Authorization: `Bearer ${authToken}` } : {}
  } catch {
    return {}
  }
}

async function postRemote(rec: TxRecord) {
  try {
    await fetch('/api/tx-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ record: rec }),
    })
  } catch {
    /* remote history is best-effort */
  }
}

export const txHistory = {
  list(): TxRecord[] {
    return read().sort((a, b) => b.ts - a.ts)
  },
  add(rec: TxRecord) {
    const items = read()
    items.unshift(rec)
    write(items)
    postRemote(rec)
  },
  update(id: string, patch: Partial<TxRecord>) {
    let updated: TxRecord | null = null
    const items = read().map(r => {
      if (r.id !== id) return r
      updated = { ...r, ...patch }
      return updated
    })
    write(items)
    if (updated) postRemote(updated)
  },
  clear() {
    write([])
  },
  merge(items: TxRecord[]) {
    const byId = new Map<string, TxRecord>()
    for (const item of [...items, ...read()]) {
      if (!item?.id) continue
      byId.set(item.id, item)
    }
    write([...byId.values()].sort((a, b) => b.ts - a.ts))
  },
  async syncRemote() {
    try {
      const resp = await fetch('/api/tx-history', { headers: authHeaders() })
      if (!resp.ok) return
      const data = await resp.json()
      if (Array.isArray(data?.history)) txHistory.merge(data.history)
    } catch {
      /* ignore */
    }
    try {
      const resp = await fetch('http://127.0.0.1:8787/history')
      if (!resp.ok) return
      const data = await resp.json()
      if (Array.isArray(data?.history)) txHistory.merge(data.history)
    } catch {
      /* local agent may be offline */
    }
  },
  subscribe(cb: () => void) {
    const handler = () => cb()
    window.addEventListener('arc-dex.tx-history', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('arc-dex.tx-history', handler)
      window.removeEventListener('storage', handler)
    }
  },
}
