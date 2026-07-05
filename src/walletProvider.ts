import { recoverTypedDataAddress } from 'viem'

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
  addProvider(providers, (activeProvider as any)?.ethereum)
  addProvider(providers, activeProvider)
  addProvider(providers, win.okxwallet?.ethereum)
  addProvider(providers, win.okxwallet)
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
  const evmProvider = (provider as any)?.ethereum
  activeProvider = validProvider(evmProvider) ? evmProvider : provider
}

export function normalizeWalletProvider(provider: Eip1193Provider): Eip1193Provider {
  const cached = normalizedProviders.get(provider)
  if (cached) return cached
  const normalized: Eip1193Provider = {
    request: async ({ method, params }) => {
      let nextParams = normalizeRequestParams(method, params)
      if (method === 'eth_signTypedData_v4' && isOkxProvider(provider)) {
        return signOkxChainlessTypedData(provider, nextParams)
      }
      if (method === 'wallet_switchEthereumChain' && hasInvalidSwitchChain(params)) {
        const activeChainId = normalizeChainId(await provider.request({ method: 'eth_chainId' }))
        if (!activeChainId) throw new Error('Wallet returned an invalid active chain ID.')
        nextParams = [{ ...(Array.isArray(params) ? params[0] as Record<string, unknown> : {}), chainId: activeChainId }]
      }
      if (method === 'eth_sendTransaction' || method === 'wallet_sendTransaction') {
        nextParams = await attachActiveTransactionChainId(provider, nextParams)
        nextParams = bufferTransactionGas(nextParams)
        nextParams = await refreshArbitrumFees(provider, nextParams)
      }
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

function isOkxProvider(provider: Eip1193Provider) {
  const win = typeof window === 'undefined' ? null : window as any
  return Boolean(
    provider.isOkxWallet
    || provider === win?.okxwallet
    || provider === win?.okxwallet?.ethereum,
  )
}

async function signOkxChainlessTypedData(provider: Eip1193Provider, params: unknown[] | object | undefined) {
  if (!Array.isArray(params) || params.length < 2) {
    return provider.request({ method: 'eth_signTypedData_v4', ...(params === undefined ? {} : { params }) })
  }
  const requestedAddress = String(params[0] || '').toLowerCase()
  const serialized = params[1]
  let typedData: any
  try { typedData = typeof serialized === 'string' ? JSON.parse(serialized) : serialized } catch {
    return provider.request({ method: 'eth_signTypedData_v4', params })
  }
  const domainFields = Array.isArray(typedData?.types?.EIP712Domain) ? typedData.types.EIP712Domain : []
  const isGatewayBurnIntent = typedData?.domain?.name === 'GatewayWallet'
    && String(typedData?.domain?.version) === '1'
    && !domainFields.some((field: any) => field?.name === 'chainId')
  if (!isGatewayBurnIntent || typedData.domain.chainId != null) {
    return provider.request({ method: 'eth_signTypedData_v4', params })
  }

  // Circle Gateway intentionally signs a chainId-less EIP-712 domain. OKX
  // Mobile validates domain.chainId even when EIP712Domain omits that field.
  // Add it only to the display/validation object while keeping the declared
  // domain type unchanged, then verify the returned signature against the
  // original chainId-less digest before accepting it.
  const activeChainHex = normalizeChainId(await provider.request({ method: 'eth_chainId' }))
  if (!activeChainHex) throw new Error('OKX returned an invalid active chain ID for typed-data signing.')
  const activeChainNumber = Number(BigInt(activeChainHex))
  if (!Number.isSafeInteger(activeChainNumber)) throw new Error('OKX returned an unsupported active chain ID.')
  const okxTypedData = {
    ...typedData,
    domain: { ...typedData.domain, chainId: activeChainNumber },
  }
  const nextParams = [params[0], typeof serialized === 'string' ? JSON.stringify(okxTypedData) : okxTypedData, ...params.slice(2)]
  const signature = await provider.request({ method: 'eth_signTypedData_v4', params: nextParams })
  const recoveredAddress = await recoverTypedDataAddress({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
    signature,
  })
  if (recoveredAddress.toLowerCase() !== requestedAddress) {
    throw new Error('OKX signed a different Gateway digest. The withdrawal was stopped before submission.')
  }
  return signature
}

async function attachActiveTransactionChainId(provider: Eip1193Provider, params: unknown[] | object | undefined) {
  if (!Array.isArray(params) || !params.length) return params
  const tx = params[0] as Record<string, unknown> | undefined
  if (!tx) return params
  const activeChainId = normalizeChainId(await provider.request({ method: 'eth_chainId' }))
  if (!activeChainId) throw new Error('Wallet returned an invalid active chain ID before sending the transaction.')
  const providedChainId = normalizeChainId(tx.chainId)
  if (providedChainId && providedChainId !== activeChainId) {
    throw new Error(`Transaction chain ID ${providedChainId} does not match the active wallet chain ID ${activeChainId}.`)
  }
  return [{ ...tx, chainId: activeChainId }, ...params.slice(1)]
}

function bufferTransactionGas(params: unknown[] | object | undefined) {
  if (!Array.isArray(params) || !params.length) return params
  const tx = params[0] as Record<string, unknown> | undefined
  if (!tx?.gas) return params
  try {
    const gas = BigInt(String(tx.gas))
    if (gas <= 0n) return params
    // Gateway authorization calls can take a materially different path between
    // estimation and execution. A generous limit is safe: users only pay gas used.
    const bufferedGas = (gas * 8n) / 5n + 20_000n
    return [{ ...tx, gas: `0x${bufferedGas.toString(16)}` }, ...params.slice(1)]
  } catch {
    return params
  }
}

async function refreshArbitrumFees(provider: Eip1193Provider, params: unknown[] | object | undefined) {
  if (!Array.isArray(params) || !params.length) return params
  const tx = params[0] as Record<string, unknown> | undefined
  if (!tx) return params
  try {
    const chainId = normalizeChainId(tx.chainId) || normalizeChainId(await provider.request({ method: 'eth_chainId' }))
    if (chainId !== '0x66eee') return params
    const [block, rpcPriority] = await Promise.all([
      provider.request({ method: 'eth_getBlockByNumber', params: ['pending', false] }),
      provider.request({ method: 'eth_maxPriorityFeePerGas' }).catch(() => '0x186a0'),
    ])
    const baseFee = BigInt(block?.baseFeePerGas || 0)
    const currentMax = BigInt(String(tx.maxFeePerGas || 0))
    const currentPriority = BigInt(String(tx.maxPriorityFeePerGas || 0))
    const priority = [BigInt(rpcPriority || 0), currentPriority, 100_000n].reduce((max, value) => value > max ? value : max, 0n)
    const bufferedMax = (baseFee * 125n) / 100n + priority
    const maxFeePerGas = bufferedMax > currentMax ? bufferedMax : currentMax
    const next: Record<string, unknown> = { ...tx, maxFeePerGas: `0x${maxFeePerGas.toString(16)}`, maxPriorityFeePerGas: `0x${priority.toString(16)}` }
    delete next.gasPrice
    return [next, ...params.slice(1)]
  } catch {
    return params
  }
}

function hasInvalidSwitchChain(params: unknown[] | object | undefined) {
  if (!Array.isArray(params) || !params.length) return false
  const first = params[0] as Record<string, unknown> | undefined
  return Boolean(first && !normalizeChainId(first.chainId))
}

function normalizeRequestParams(method: string, params: unknown[] | object | undefined) {
  if (!Array.isArray(params) || !params.length) return params
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
    const first = params[0] as Record<string, unknown> | undefined
    const chainId = normalizeChainId(first?.chainId)
    return first && chainId ? [{ ...first, chainId }, ...params.slice(1)] : params
  }
  if (method === 'eth_sendTransaction' || method === 'wallet_sendTransaction') {
    const tx = params[0] as Record<string, unknown> | undefined
    if (!tx) return params
    const next = normalizeTransactionQuantities(tx)
    if ('chainId' in next) {
      const chainId = normalizeChainId(next.chainId)
      if (chainId) next.chainId = chainId
      else delete next.chainId
    }
    return [next, ...params.slice(1)]
  }
  return params
}

function normalizeTransactionQuantities(tx: Record<string, unknown>) {
  const next = { ...tx }
  for (const field of ['gas', 'gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'nonce'] as const) {
    if (!(field in next)) continue
    const value = normalizeRpcQuantity(next[field])
    if (value) next[field] = value
    else delete next[field]
  }
  if ('value' in next) next.value = normalizeRpcQuantity(next.value) || '0x0'
  return next
}

function normalizeRpcQuantity(value: unknown): string | null {
  if (typeof value === 'bigint') return value >= 0n ? `0x${value.toString(16)}` : null
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? `0x${value.toString(16)}` : null
  const text = String(value ?? '').trim()
  if (/^0x[0-9a-f]+$/i.test(text)) return `0x${BigInt(text).toString(16)}`
  if (/^\d+$/.test(text)) return `0x${BigInt(text).toString(16)}`
  return null
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
