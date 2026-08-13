// walletConnect.ts — WalletConnect v2 EIP-1193 provider bridge
// Required chain = mainnet+sepolia (dikenal semua wallet).
// Arc Testnet = optional, di-add/switch setelah connect.

import { EthereumProvider } from '@walletconnect/ethereum-provider'

const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID || ''

const ARC_CHAIN_ID = 5042002
const ARC_HEX = '0x4cef52' // 5042002 hex (0x4CFD32 was WRONG = 5045554)
const ARC_CHAIN_PARAMS = {
  chainId: ARC_HEX,
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: ['https://rpc.testnet.arc.io'],
  blockExplorerUrls: ['https://testnet.arcscan.app'],
}

let wcProvider: any = null

export function isWalletConnectAvailable(): boolean {
  return Boolean(WC_PROJECT_ID)
}

// Native scheme + universal link fallback per wallet
const WALLET_LINKS: Record<string, { native: string; universal: string }> = {
  'MetaMask': { native: 'https://metamask.app.link/wc?uri=', universal: 'https://metamask.app.link/wc?uri=' },
  'Trust': { native: 'trust://wc?uri=', universal: 'https://link.trustwallet.com/wc?uri=' },
  'OKX': { native: 'okex://main/wc?uri=', universal: 'https://www.okx.com/download?deeplink=' },
  'Bitget': { native: 'bitkeep://wc?uri=', universal: 'https://bkcode.vip?action=dapp&url=' },
  'Rainbow': { native: 'rainbow://wc?uri=', universal: 'https://rnbwapp.com/wc?uri=' },
}

let pendingUri: string | null = null
let uriResolve: ((uri: string) => void) | null = null
let visibilityHandler: (() => void) | null = null
let relayOpenPromise: Promise<boolean> | null = null

function removeVisibilityHandler() {
  if (visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler)
  }
  visibilityHandler = null
  relayOpenPromise = null
}

export const isMobile = () => /Android|iPhone|iPad/i.test(navigator.userAgent || '')

/**
 * Reset the WC provider singleton so a fresh init is performed on next attempt.
 * This prevents the stale-provider hang where a previous cancelled/failed
 * session leaves wcProvider in a half-connected state.
 */
function resetProvider() {
  removeVisibilityHandler()
  if (wcProvider) {
    try { wcProvider.removeAllListeners?.() } catch { /* ignore */ }
  }
  wcProvider = null
  pendingUri = null
  uriResolve = null
  // Clear stale WalletConnect v2 localStorage entries that can cause
  // init to hang on mobile Chrome when recovering from a broken session.
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (key.startsWith('wc@2:') || key.startsWith('wc_') || key === 'walletconnect')) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k))
  } catch { /* ignore */ }
}

export async function getWalletConnectProvider(): Promise<any | null> {
  if (wcProvider) return wcProvider
  if (!WC_PROJECT_ID) return null

  try {
    wcProvider = await EthereumProvider.init({
      projectId: WC_PROJECT_ID,
      // Sepolia as required — dikenal semua wallet testnet, jadi default chain
      // tidak mismatch. Mainnet + Arc = optional.
      chains: [11155111],
      optionalChains: [1, ARC_CHAIN_ID],
      // IMPORTANT: eth_sign intentionally excluded — modern wallets auto-reject
      // session proposals containing eth_sign (phishing risk).
      methods: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'],
      events: ['accountsChanged', 'chainChanged'],
      rpcMap: {
        1: 'https://eth.llamarpc.com',
        11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
        [ARC_CHAIN_ID]: 'https://rpc.testnet.arc.io',
      },
      showQrModal: true,
      metadata: {
        name: 'ARCOX DEX',
        description: 'Arc Testnet DEX + AI Agent',
        url: 'https://arcoxdex.vercel.app',
        icons: ['https://arcoxdex.vercel.app/favicon.svg'],
      },
    })

    wcProvider.on('display_uri', (uri: string) => {
      console.log('[WC] URI ready')
      pendingUri = uri
      if (uriResolve) { uriResolve(uri); uriResolve = null }
      // AppKit owns the wallet picker and deep links on mobile. Do not render
      // a competing custom modal: it leaves users stuck in "waiting wallet".
    })

    wcProvider.on('connect', () => { console.log('[WC] connected'); hideQRModal() })
    wcProvider.on('disconnect', () => { resetProvider() })
    wcProvider.on('session_delete', () => { resetProvider() })
    wcProvider.on('chainChanged', (c: string) => console.log('[WC] chainChanged:', c))

    if (typeof document !== 'undefined') {
      removeVisibilityHandler()
      // Mobile wallets background the browser while the signing request is
      // open. Re-open the relay *and await it* when the tab returns so the
      // original personal_sign request can receive its response without a
      // disconnect/reconnect cycle.
      visibilityHandler = () => {
        if (document.visibilityState === 'visible') void resumeWalletConnect()
      }
      document.addEventListener('visibilitychange', visibilityHandler)
    }

    return wcProvider
  } catch (e) {
    console.error('[WC] init failed:', e)
    resetProvider()
    return null
  }
}

/**
 * Wait for the WC display_uri event with a timeout.
 * On mobile with slow connections, the relay WebSocket may take time
 * to establish. If it exceeds timeoutMs, reject so the UI can show
 * an error instead of hanging indefinitely.
 */
function waitForUri(timeoutMs = 20000): Promise<string> {
  if (pendingUri) return Promise.resolve(pendingUri)
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      uriResolve = null
      reject(new Error('Koneksi ke relay WalletConnect gagal — periksa internet Anda lalu coba lagi'))
    }, timeoutMs)
    uriResolve = (uri: string) => {
      clearTimeout(timer)
      resolve(uri)
    }
  })
}

function showQRModal(uri: string) {
  hideQRModal()

  const overlay = document.createElement('div')
  overlay.id = 'wc-qr-modal'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;'

  const modal = document.createElement('div')
  modal.style.cssText = 'background:#1a1a2e;border-radius:16px;padding:24px;max-width:380px;width:100%;text-align:center;max-height:90vh;overflow-y:auto;'

  const status = document.createElement('div')
  status.id = 'wc-status'
  status.textContent = 'Menunggu wallet...'
  status.style.cssText = 'color:#fbbf24;font-size:13px;margin-bottom:12px;font-weight:600;'

  const title = document.createElement('div')
  title.textContent = 'Hubungkan Wallet'
  title.style.cssText = 'color:#e2e8f0;font-size:18px;font-weight:700;margin-bottom:4px;'

  const subtitle = document.createElement('div')
  subtitle.textContent = isMobile() ? 'Pilih wallet — akan membuka app langsung' : 'Scan QR dengan app wallet di HP'
  subtitle.style.cssText = 'color:#94a3b8;font-size:12px;margin-bottom:16px;'

  modal.appendChild(status)
  modal.appendChild(title)
  modal.appendChild(subtitle)

  // QR hanya untuk desktop — di HP tombol direct lebih dipakai
  if (!isMobile()) {
    const qrImg = document.createElement('img')
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(uri)}`
    qrImg.alt = 'WalletConnect QR'
    qrImg.style.cssText = 'border-radius:8px;width:256px;height:256px;margin:0 auto 12px;display:block;'
    modal.appendChild(qrImg)
  } else {
    // Mobile: tombol besar per wallet, tap = langsung buka app dengan pairing request
    const grid = document.createElement('div')
    grid.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-bottom:4px;'

    for (const [name, links] of Object.entries(WALLET_LINKS)) {
      const btn = document.createElement('button')
      btn.textContent = name
      btn.style.cssText = 'padding:14px;border-radius:10px;border:1px solid rgba(99,102,241,0.4);background:rgba(99,102,241,0.15);color:#a5b4fc;font-size:15px;font-weight:700;cursor:pointer;'
      btn.onclick = () => {
        const s = document.getElementById('wc-status')
        if (s) { s.textContent = `Membuka ${name}... approve di app wallet, lalu kembali ke sini`; s.style.color = '#34d399' }
        // Universal links work reliably from Chrome mobile and preserve the
        // WalletConnect pairing context better than forced native schemes.
        const link = links.universal !== links.native ? links.universal : links.native
        window.location.assign(link + encodeURIComponent(uri))
      }
      grid.appendChild(btn)
    }
    modal.appendChild(grid)

    const qrToggle = document.createElement('a')
    qrToggle.textContent = 'Atau scan QR (desktop)'
    qrToggle.style.cssText = 'color:#64748b;font-size:12px;cursor:pointer;text-decoration:underline;display:block;margin:8px 0;'
    qrToggle.onclick = () => {
      if (document.getElementById('wc-qr-img')) return
      const qr = document.createElement('img')
      qr.id = 'wc-qr-img'
      qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(uri)}`
      qr.style.cssText = 'border-radius:8px;width:200px;height:200px;margin:12px auto;display:block;'
      modal.insertBefore(qr, grid)
    }
    modal.appendChild(qrToggle)
  }

  const closeBtn = document.createElement('button')
  closeBtn.textContent = 'Batal'
  closeBtn.style.cssText = 'margin-top:14px;padding:10px;border-radius:8px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.1);color:#f87171;cursor:pointer;font-size:13px;width:100%;'
  closeBtn.onclick = () => { hideQRModal(); wcProvider?.disconnect?.().catch(() => {}); resetProvider() }

  modal.appendChild(closeBtn)
  overlay.appendChild(modal)
  document.body.appendChild(overlay)
}

function hideQRModal() {
  document.getElementById('wc-qr-modal')?.remove()
}

/**
 * Redirect the mobile user back to the wallet app.
 * Called after WC connect when a signing request (personal_sign) is about
 * to be sent through the relay — the user needs to be in the wallet app
 * to approve it.
 */
export async function resumeWalletConnect(): Promise<boolean> {
  if (relayOpenPromise) return relayOpenPromise
  relayOpenPromise = (async () => {
    try {
      const client = wcProvider?.signer?.client
      const relayer = client?.core?.relayer
      if (!relayer || typeof relayer.transportOpen !== 'function') return false
      // A visibility callback must never reserve the shared resume promise
      // forever when the relay is unreachable. The next approval attempt can
      // then make a fresh bounded resume without a reconnect or page refresh.
      await Promise.race([
        Promise.resolve(relayer.transportOpen()),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('WalletConnect relay open timeout')), 8_000)),
      ])
      return true
    } catch {
      return false
    } finally {
      relayOpenPromise = null
    }
  })()
  return relayOpenPromise
}

export function redirectToWalletForSign() {
  if (!isMobile() || !wcProvider?.session) return

  const peer = wcProvider.session?.peer?.metadata
  const redirect = peer?.redirect
  const name = (peer?.name || '').toLowerCase()
  let target = ''

  // 1. Try the session peer's own redirect metadata (most reliable)
  if (redirect?.native) target = redirect.native
  else if (redirect?.universal) target = redirect.universal
  // 2. Fallback: known wallet deep-links by name
  else if (name.includes('metamask')) target = 'https://metamask.app.link'
  else if (name.includes('trust')) target = 'https://link.trustwallet.com'
  else if (name.includes('okx') || name.includes('okex')) target = 'okex://main'
  else if (name.includes('bitget') || name.includes('bitkeep')) target = 'https://bkcode.vip'
  else if (name.includes('rainbow')) target = 'https://rnbwapp.com'

  if (!target) {
    // No redirect metadata is still valid for wallets that rely on push
    // notifications; do not replace the active approval page in that case.
    console.log('[WC] No redirect available for wallet:', peer?.name)
    return
  }

  // Never navigate the OAuth page itself. It owns the pending personal_sign
  // promise and must remain alive to receive the response when the user returns
  // from the wallet app. Opening the universal link in a new tab lets mobile
  // Chrome hand the link to the wallet while preserving that page.
  const opened = window.open(target, '_blank', 'noopener,noreferrer')
  if (!opened) {
    const anchor = document.createElement('a')
    anchor.href = target
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.click()
  }
}

// Setelah connect: tambah + pindah ke Arc Testnet (best effort, non-blocking)
async function ensureArcChain(provider: any): Promise<void> {
  try {
    const session = provider.session
    if (session?.namespaces?.eip155?.chains) {
      const chains = session.namespaces.eip155.chains
      const hasArc = chains.some((c: string) => c.includes(String(ARC_CHAIN_ID)))
      if (!hasArc) {
        console.log('[WC] wallet does not have Arc chain, skipping switch')
        return
      }
    }
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARC_HEX }],
    })
    console.log('[WC] switched to Arc')
  } catch (e: any) {
    if (e?.code === 4902 || /unrecognized|not added|does not exist/i.test(e?.message || '')) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [ARC_CHAIN_PARAMS],
        })
        console.log('[WC] Arc chain added')
      } catch (e2) {
        console.log('[WC] add/switch Arc skipped:', (e2 as Error)?.message)
      }
    } else {
      console.log('[WC] switch Arc skipped:', (e as Error)?.message)
    }
  }
}

export async function restoreWalletConnect(): Promise<string | null> {
  try {
    const provider = await getWalletConnectProvider()
    if (!provider?.session) return null
    const accounts = await provider.request({ method: 'eth_accounts' })
    const address = accounts?.[0] || provider.accounts?.[0]
    if (address) return address
  } catch (e) {
    console.warn('[WC] restore failed:', e)
    resetProvider()
  }
  return null
}

export async function connectWalletConnect(): Promise<string | null> {
  try {
    // Reset stale provider before attempting new connection.
    if (wcProvider && !wcProvider.session) {
      resetProvider()
    }

    const provider = await getWalletConnectProvider()
    if (!provider) throw new Error('WalletConnect tidak tersedia — pastikan VITE_WC_PROJECT_ID sudah dikonfigurasi')

    pendingUri = null

    // enable() = connect + session settle + accounts terisi.
    const enablePromise: Promise<string[]> = provider.enable()

    // Wait for URI with timeout — prevents infinite hang on mobile
    // when the relay WebSocket fails to establish.
    await waitForUri(30000)
    console.log('[WC] URI shown, waiting wallet approve')

    let accounts: string[] = []
    try {
      accounts = await Promise.race([
        enablePromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('WalletConnect timeout — approve di wallet lalu kembali ke browser')), 180000))
      ])
    } catch (e) {
      console.log('[WC] enable result:', (e as Error)?.message || e)
      resetProvider()
      throw e
    }

    let address = (accounts || [])[0] || (provider.accounts || [])[0]

    // Fallback: session namespaces (CAIP-10: eip155:chainId:address)
    if (!address) {
      const ns = provider.session?.namespaces || {}
      for (const n of Object.values(ns) as any[]) {
        if (n?.accounts?.length) { address = n.accounts[0].split(':').pop(); break }
      }
    }

    // Fallback terakhir: RPC langsung
    if (!address) {
      try {
        const accs = await provider.request({ method: 'eth_accounts' })
        address = accs?.[0]
      } catch {}
    }

    if (!address) {
      resetProvider()
      throw new Error('WalletConnect tidak mengembalikan address')
    }

    console.log('[WC] address:', address)
    hideQRModal()

    // Switch ke Arc Testnet di background — jangan block login kalau wallet menolak
    ensureArcChain(provider).catch(() => {})

    return address
  } catch (e: any) {
    hideQRModal()
    if (/reject|denied|cancel|reset/i.test(e?.message || '')) {
      resetProvider()
      return null
    }
    resetProvider()
    if (/Koneksi ke relay WalletConnect gagal/.test(e?.message || '')) {
      throw new Error('Relay WalletConnect tidak merespons. Periksa jaringan/VPN/ad blocker lalu coba lagi.')
    }
    if (/WalletConnect timeout/.test(e?.message || '')) {
      throw new Error('Wallet belum menyetujui koneksi. Pilih wallet dari panel WalletConnect, approve, lalu kembali ke Chrome.')
    }
    throw e
  }
}

export async function disconnectWalletConnect(): Promise<void> {
  // Clear the singleton before awaiting the SDK. A dead relay can leave
  // disconnect() pending; retries must still receive a fresh provider rather
  // than reusing that broken instance.
  const provider = wcProvider
  resetProvider()
  try {
    await Promise.race([
      Promise.resolve(provider?.disconnect?.()),
      new Promise(resolve => setTimeout(resolve, 2_000)),
    ])
  } catch { /* ignore */ }
}

export function getWalletConnectProviderSync(): any | null {
  return wcProvider
}
