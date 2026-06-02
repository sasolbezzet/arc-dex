export type TxRecord = {
  id: string
  ts: number
  from: ChainName
  to: ChainName
  amount: string
  token?: string
  status: 'pending' | 'success' | 'error'
  burnTx?: string
  burnExplorerUrl?: string
  mintTx?: string
  mintExplorerUrl?: string
  srcDomain: number
  dstDomain: number
  error?: string
  note?: string
}

type ChainName = string

const KEY = 'arc-dex.tx-history.v1'
const MAX_ITEMS = 50

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

export const txHistory = {
  list(): TxRecord[] {
    return read().sort((a, b) => b.ts - a.ts)
  },
  add(rec: TxRecord) {
    const items = read()
    items.unshift(rec)
    write(items)
  },
  update(id: string, patch: Partial<TxRecord>) {
    const items = read().map(r => (r.id === id ? { ...r, ...patch } : r))
    write(items)
  },
  clear() {
    write([])
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
