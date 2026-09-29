/**
 * REGRESSION GUARD — menghubungkan atau memutus wallet tidak boleh memindahkan
 * halaman.
 *
 * Kunjungan pertama pernah mendarat di dashboard Plugin, bukan Home, karena
 * `App.tsx` mengoper `onConnected` ke `WalletButton` yang memanggil
 * `navigate('plugin')` setiap kali koneksi berhasil (commit 5e68fdda). Dua hal
 * yang dijaga di sini:
 *
 *   1. komponennya sendiri tidak pernah menyentuh riwayat navigasi — ia hanya
 *      melaporkan koneksi lewat callback;
 *   2. pemakaiannya di `App.tsx` tidak memasang kembali redirect tersebut, dan
 *      disconnect tetap hanya membersihkan state.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '../i18n'
import { setWalletProvider, type Eip1193Provider } from '../walletProvider'
import { WalletButton } from './WalletButton'
import { disconnectWalletConnect } from '../services/walletConnect'

// WalletConnect di-stub: test ini menguji perilaku WalletButton, bukan relay
// WalletConnect. Tanpa stub, mount akan menginisialisasi EthereumProvider nyata
// (lambat, dan mencetak peringatan metadata.url di jsdom).
vi.mock('../services/walletConnect', () => ({
  connectWalletConnect: vi.fn(async () => null),
  restoreWalletConnect: vi.fn(async () => null),
  disconnectWalletConnect: vi.fn(async () => {}),
  getWalletConnectProviderSync: vi.fn(() => null),
  isWalletConnectAvailable: vi.fn(() => false),
  isMobile: vi.fn(() => false),
}))

const ADDRESS = '0xE34FF1D2C925DDafB28C95C2396fC49A6f64569e'

// `import.meta.url` bukan URL file di Vitest, jadi cari App.tsx dari cwd supaya
// guard ini tetap jalan baik suite dijalankan dari `arc-dex` maupun dari root repo.
const appTsx = ['src/App.tsx', 'arc-dex/src/App.tsx']
  .map(candidate => resolve(process.cwd(), candidate))
  .find(existsSync)
if (!appTsx) throw new Error(`App.tsx tidak ditemukan dari cwd ${process.cwd()}`)
const appSource = readFileSync(appTsx, 'utf8')

function walletShim(): Eip1193Provider {
  return {
    request: async ({ method }: { method: string }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ADDRESS]
      if (method === 'eth_chainId') return '0x13b2'
      throw new Error(`wallet shim tidak mendukung ${method}`)
    },
    on: () => {},
    removeListener: () => {},
  }
}

describe('WalletButton tidak memindahkan halaman', () => {
  let container: HTMLDivElement
  let pushState: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    window.history.replaceState(null, '', '/')
    pushState = vi.spyOn(window.history, 'pushState')
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    pushState.mockRestore()
    container.remove()
    delete (window as { ethereum?: unknown }).ethereum
  })

  it('tetap di halaman yang sama setelah connect berhasil', async () => {
    const ethereum = walletShim()
    ;(window as unknown as { ethereum: Eip1193Provider }).ethereum = ethereum
    setWalletProvider(ethereum)
    const onConnect = vi.fn(async () => {})
    const onDisconnect = vi.fn()
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <I18nProvider>
          <WalletButton address={null} onConnect={onConnect} onDisconnect={onDisconnect} />
        </I18nProvider>,
      )
    })

    const connect = [...container.querySelectorAll('button')].find(button => /connect|hubungkan/i.test(button.textContent || ''))
    expect(connect).toBeTruthy()
    await act(async () => { connect!.click() })

    expect(onConnect).toHaveBeenCalledWith(ADDRESS)
    expect(pushState).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/')
    await act(async () => { root.unmount() })
  })

  it('hanya melaporkan disconnect, tanpa memindahkan halaman', async () => {
    const onConnect = vi.fn(async () => {})
    const onDisconnect = vi.fn()
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <I18nProvider>
          <WalletButton address={ADDRESS} onConnect={onConnect} onDisconnect={onDisconnect} />
        </I18nProvider>,
      )
    })

    const disconnect = container.querySelector('button')
    expect(disconnect).toBeTruthy()
    await act(async () => { disconnect!.click() })

    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(disconnectWalletConnect).toHaveBeenCalledTimes(1)
    expect(pushState).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/')
    await act(async () => { root.unmount() })
  })
})

describe('wiring wallet di App.tsx', () => {
  it('memakai WalletButton tanpa handler redirect', () => {
    const usage = appSource.match(/<WalletButton[\s\S]*?\/>/)?.[0] || ''
    expect(usage).not.toBe('')
    expect(usage).toMatch(/onConnect=/)
    expect(usage).toMatch(/onDisconnect=/)
    expect(usage).not.toMatch(/onConnected/)
    expect(usage).not.toMatch(/navigate\(|pushState|location\.(assign|replace)/)
  })

  it('membersihkan sesi saat disconnect tanpa berpindah halaman', () => {
    const line = appSource.match(/^.*const handleDisconnect.*$/m)?.[0] || ''
    expect(line).not.toBe('')
    expect(line).toMatch(/clearAuthSession\(\)/)
    expect(line).toMatch(/setAddress\(null\)/)
    expect(line).not.toMatch(/navigate\(|pushState|location\.(assign|replace)/)
  })
})
