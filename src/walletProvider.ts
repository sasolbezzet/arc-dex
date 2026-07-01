export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<any>
  on?: (event: string, listener: (...args: any[]) => void) => void
  removeListener?: (event: string, listener: (...args: any[]) => void) => void
  isOkxWallet?: boolean
  isBitKeep?: boolean
}

let activeProvider: Eip1193Provider | null = null
const announcedProviders: Eip1193Provider[] = []

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
