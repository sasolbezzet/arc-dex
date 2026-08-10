export const AUTO_MINT_HANDOFF_MS = 30_000
export const AUTO_MINT_POLL_INTERVAL_MS = 3_000
export const AUTO_MINT_MAX_WAIT_MS = 10 * 60 * 1000
const MINT_LOCK_TTL_MS = 10 * 60 * 1000

export function shouldHandoffToAutoMintWorker(startedAt: number, now = Date.now()): boolean {
  return now - startedAt >= AUTO_MINT_HANDOFF_MS
}

export function isAutoMintWorkerTerminal(status: unknown): boolean {
  return status === 'ready' || status === 'timeout' || status === 'error'
}

export function acquireMintLock(burnTx: string, now = Date.now()): boolean {
  if (typeof localStorage === 'undefined') return true
  const key = `arc-dex.cctp-mint-lock:${burnTx.toLowerCase()}`
  try {
    const current = Number(localStorage.getItem(key) || 0)
    if (current > 0 && now - current < MINT_LOCK_TTL_MS) return false
    localStorage.setItem(key, String(now))
    return true
  } catch {
    return true
  }
}

export function releaseMintLock(burnTx: string): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.removeItem(`arc-dex.cctp-mint-lock:${burnTx.toLowerCase()}`) } catch {}
}
