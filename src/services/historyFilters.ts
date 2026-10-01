import type { TxRecord } from '../txHistory'

// History panel filters. Agent bridges (source 'agent-mcp') now appear next to
// web-UI rows, so the panel needs a chain and a status filter to answer "where
// did this balance change come from" without scrolling a mixed list.
export type HistoryKindFilter = 'all' | 'pending' | 'bridge' | 'swap' | 'send' | 'agent'
export type HistoryStatusFilter = 'all' | 'pending' | 'success' | 'error'
export type HistoryChainFilter = 'all' | 'Arc' | 'Base' | 'Arbitrum' | 'Ethereum'

export interface HistoryFilterInput {
  kind?: HistoryKindFilter
  chain?: HistoryChainFilter
  status?: HistoryStatusFilter
}

export function filterHistory(records: TxRecord[], { kind = 'all', chain = 'all', status = 'all' }: HistoryFilterInput = {}): TxRecord[] {
  const rows = Array.isArray(records) ? records : []
  return rows.filter(rec => {
    if (!rec) return false
    if (kind === 'pending') {
      if (rec.status === 'success') return false
    } else if (kind === 'agent') {
      if (rec.source !== 'agent-mcp') return false
    } else if (kind !== 'all' && (rec.action || 'bridge') !== kind) {
      return false
    }
    // A hop is in the list when either end matches, so a Base→Arc bridge shows
    // on both the Base and the Arc filter.
    if (chain !== 'all' && rec.from !== chain && rec.to !== chain) return false
    if (status !== 'all' && rec.status !== status) return false
    return true
  })
}
