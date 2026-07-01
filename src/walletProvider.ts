export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<any>
  on?: (event: string, listener: (...args: any[]) => void) => void
  removeListener?: (event: string, listener: (...args: any[]) => void) => void
  isOkxWallet?: boolean
  isBitKeep?: boolean
}

let activeProvider: Eip1193Provider | null = null
const announcedProviders: Eip1193Provider[] = []
const normalizedProviders = new WeakMap<Eip1193Provider, Eip1193Provider>()

function validProvider(value: any): value is Eip1193Provider {
  return Boolean(value && typeof value.request === 'function')
}

function addProvider(list: Eip1193Provider[], value: any) {
  if (validProvider(value) && !list.includes(value)) list.push(value)
}

export function walletProviders(): Eip1193Provider[] {
  const win = window as any
  const providers: Eip1193Provider[] = []
  addProvider(providers, activeProvider)
  addProvider(providers, win.okxwallet)
  addProvider(providers, win.okxwallet?.ethereum)
  addProvider(providers, win.bitkeep?.ethereum)
  addProvider(providers, win.bitgetWallet?.ethereum)
  addProvider(providers, win.bitgetWallet)
  for (const provider of announcedProviders) addProvider(providers, provider)
  for (const provider of win.ethereum?.providers || []) addProvider(providers, provider)
  addProvider(providers, win.ethereum)
  return providers
}

export function getWalletProvider(): Eip1193Provider | null {
  return activeProvider || walletProviders()[0] || null
}

export function setWalletProvider(provider: Eip1193Provider | null) {
  activeProvider = provider
}

export function normalizeWalletProvider(provider: Eip1193Provider): Eip1193Provider {
  const cached = normalizedProviders.get(provider)
  if (cached) return cached
  const normalized: Eip1193Provider = {
    request: async ({ method, params }) => {
      const nextParams = normalizeRequestParams(method, params)
      const result = await provider.request({ method, ...(nextParams === undefined ? {} : { params: nextParams }) })
      if (method !== 'eth_chainId') return result
      const chainId = normalizeChainId(result)
      if (!chainId) throw new Error(`Wallet returned an invalid chain ID: ${String(result)}`)
      return chainId
    },
    on: provider.on?.bind(provider),
    removeListener: provider.removeListener?.bind(provider),
    isOkxWallet: provider.isOkxWallet,
    isBitKeep: provider.isBitKeep,
  }
  normalizedProviders.set(provider, normalized)
  return normalized
}

function normalizeRequestParams(method: string, params: unknown[] | object | undefined) {
  if (!Array.isArray(params) || !params.length) return params
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
    const first = params[0] as Record<string, unknown> | undefined
    const chainId = normalizeChainId(first?.chainId)
    return first && chainId ? [{ ...first, chainId }, ...params.slice(1)] : params
  }
  if (method === 'eth_sendTransaction') {
    const tx = params[0] as Record<string, unknown> | undefined
    if (!tx || !('chainId' in tx)) return params
    const chainId = normalizeChainId(tx.chainId)
    const next = { ...tx }
    if (chainId) next.chainId = chainId
    else delete next.chainId
    return [next, ...params.slice(1)]
  }
  return params
}

function normalizeChainId(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? `0x${value.toString(16)}` : null
  if (typeof value === 'bigint') return value > 0n ? `0x${value.toString(16)}` : null
  const text = String(value || '').trim()
  if (/^0x[0-9a-f]+$/i.test(text)) return `0x${BigInt(text).toString(16)}`
  if (/^[1-9]\d*$/.test(text)) return `0x${BigInt(text).toString(16)}`
  return null
}

export async function findConnectedWalletProvider(expectedAddress?: string | null): Promise<Eip1193Provider | null> {
  const expected = String(expectedAddress || '').toLowerCase()
  for (const provider of walletProviders()) {
    try {
      const accounts = await provider.request({ method: 'eth_accounts' })
      if (!accounts?.[0]) continue
      if (!expected || String(accounts[0]).toLowerCase() === expected) {
        activeProvider = provider
        return provider
      }
    } catch {}
  }
  return getWalletProvider()
}

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', ((event: CustomEvent) => {
    addProvider(announcedProviders, event.detail?.provider)
  }) as EventListener)
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}
