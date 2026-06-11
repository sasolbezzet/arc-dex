import { useState, useEffect, useRef, useCallback } from 'react'
import { WalletButton } from './components/WalletButton'
import { SwapPanel } from './components/SwapPanel'
import { BridgePanel } from './components/BridgePanel'
import { SendPanel } from './components/SendPanel'
import { ReceivePanel } from './components/ReceivePanel'
import { AgenticPanel } from './components/AgenticPanel'
import { InfoPanel } from './components/InfoPanel'
import { DocsPanel } from './components/DocsPanel'
import { PayCheckout } from './components/PayCheckout'
import { PaySandbox } from './components/PaySandbox'
import { LANGUAGES, useI18n } from './i18n'
import { clearAuthSession, ensureAuthSession, getAuthToken } from './auth'

const API = ''
const EMPTY_BAL = { USDC:'0', EURC:'0', USYC:'0', cirBTC:'0' }

const NAV = [
  { id: 'intro', path: '/', label: 'Intro', icon: '⌂' },
  { id: 'portfolio', path: '/portfolio', label: 'Portfolio', icon: '▦' },
  { id: 'swap', path: '/swap', label: 'Swap', icon: '⇄' },
  { id: 'bridge', path: '/bridge', label: 'Bridge', icon: '⛓' },
  { id: 'send', path: '/send', label: 'Send', icon: '→' },
  { id: 'receive', path: '/receive', label: 'Receive', icon: '↓' },
  { id: 'agentic', path: '/agent-jobs', label: 'Agent Jobs', icon: '◎' },
  { id: 'info', path: '/info', label: 'Info', icon: 'ℹ' },
  { id: 'docs', path: '/docs', label: 'Docs', icon: '?' },
] as const

type PageId = typeof NAV[number]['id']

function ArcoxLogo() {
  return (
    <div className='arcox-logo' style={{width:36,height:36,borderRadius:10,background:'linear-gradient(135deg,#22d3ee 0%,#6366f1 48%,#f59e0b 100%)',display:'grid',placeItems:'center',boxShadow:'0 10px 28px rgba(99,102,241,0.32)',position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',inset:3,border:'1px solid rgba(255,255,255,0.38)',borderRadius:8}} />
      <div style={{width:18,height:18,border:'3px solid rgba(255,255,255,0.95)',borderLeftColor:'transparent',transform:'rotate(45deg)',borderRadius:5}} />
      <div style={{position:'absolute',width:9,height:9,borderRadius:'50%',background:'#0a0a0f',right:8,top:8,border:'2px solid rgba(255,255,255,0.9)'}} />
    </div>
  )
}

function currentPageFromLocation(): PageId {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  if (new URLSearchParams(window.location.search).get('page') === 'docs') return 'docs'
  return NAV.find(item => item.path === path)?.id || 'intro'
}

function titleFor(page: PageId) {
  if (page === 'intro') return 'ARCOX DEX'
  if (page === 'agentic') return 'Agent Jobs'
  return NAV.find(item => item.id === page)?.label || 'ARCOX DEX'
}

export default function App() {
  const { lang, setLang, t } = useI18n()
  const [page, setPage] = useState<PageId>(() => currentPageFromLocation())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [address, setAddress] = useState<string|null>(null)
  const [circleWallet, setCircleWallet] = useState<{id:string;address:string}|null>(null)
  const [balances, setBalances] = useState<Record<string,string>>({...EMPTY_BAL})
  const [eoaBalances, setEoaBalances] = useState<Record<string,string>>({...EMPTY_BAL})
  const [loadingWallet, setLoadingWallet] = useState(false)
  const [walletSetupError, setWalletSetupError] = useState('')
  const [apiStatus, setApiStatus] = useState<'checking'|'online'|'offline'>('checking')
  const connectInFlightRef = useRef('')

  const routeMode = window.location.pathname === '/pay/sandbox'
    ? 'pay-sandbox'
    : window.location.pathname === '/pay'
      ? 'pay-checkout'
      : 'normal'

  const fetchCircleBal = async (addr:string) => {
    try {
      const r = await fetch(`${API}/api/balance/${addr}`)
      if (r.ok) setBalances(await r.json())
    } catch(e) { console.error('fetchCircleBal error:', e) }
  }
  const fetchEoaBal = async (addr:string) => {
    try {
      const { createPublicClient, http, erc20Abi, formatUnits, defineChain } = await import('viem')
      const arc = defineChain({ id:5042002, name:'Arc Testnet', nativeCurrency:{name:'USDC',symbol:'USDC',decimals:6}, rpcUrls:{default:{http:['https://rpc.testnet.arc.network/']}} })
      const client = createPublicClient({ chain:arc, transport:http() })
      const USDC = '0x3600000000000000000000000000000000000000' as `0x${string}`
      const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as `0x${string}`
      const USYC = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C' as `0x${string}`
      const CIRBTC = '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF' as `0x${string}`
      const cirDecimalsRaw = await client.readContract({ address:CIRBTC, abi:erc20Abi, functionName:'decimals' }).catch(()=>6n)
      const cirDecimals = Number(cirDecimalsRaw) || 6
      const [u,e,y,c] = await Promise.all([
        client.readContract({ address:USDC, abi:erc20Abi, functionName:'balanceOf', args:[addr as `0x${string}`] }).catch(()=>0n),
        client.readContract({ address:EURC, abi:erc20Abi, functionName:'balanceOf', args:[addr as `0x${string}`] }).catch(()=>0n),
        client.readContract({ address:USYC, abi:erc20Abi, functionName:'balanceOf', args:[addr as `0x${string}`] }).catch(()=>0n),
        client.readContract({ address:CIRBTC, abi:erc20Abi, functionName:'balanceOf', args:[addr as `0x${string}`] }).catch(()=>0n),
      ])
      setEoaBalances({ USDC:formatUnits(u as bigint,6), EURC:formatUnits(e as bigint,6), USYC:formatUnits(y as bigint,6), cirBTC:formatUnits(c as bigint,cirDecimals) })
    } catch(e) { console.error('fetchEoaBal error:',e) }
  }
  const fetchCircleBalRef = useRef(fetchCircleBal)
  const fetchEoaBalRef = useRef(fetchEoaBal)
  useEffect(() => {
    fetchCircleBalRef.current = fetchCircleBal
    fetchEoaBalRef.current = fetchEoaBal
  })
  const refresh = useCallback(() => {
    if (circleWallet?.address) fetchCircleBalRef.current(circleWallet.address)
    if (address) fetchEoaBalRef.current(address)
  }, [circleWallet, address])

  const navigate = (next: PageId) => {
    const nav = NAV.find(item => item.id === next)
    if (!nav) return
    window.history.pushState(null, '', nav.path)
    setPage(next)
    setDrawerOpen(false)
  }

  const loadCircleWallet = async (addr:string, token = getAuthToken()) => {
    let lastError = ''
    for (let i=0;i<3;i++) {
      try {
        const r = await fetch(`${API}/api/wallet`, {
          method:'POST',
          headers:{'Content-Type':'application/json', Authorization:`Bearer ${token || getAuthToken()}`},
          body:JSON.stringify({metamaskAddress:addr}),
        })
        if (!r.ok) {
          if (r.status === 401) {
            clearAuthSession()
            token = await ensureAuthSession(addr, true)
            continue
          }
          const text = await r.text().catch(() => '')
          lastError = text || `HTTP ${r.status}`
          await new Promise(x=>setTimeout(x,2000))
          continue
        }
        const d = await r.json()
        if (d.success) {
          setCircleWallet(d.wallet)
          fetchCircleBal(d.wallet.address)
          setWalletSetupError('')
          return true
        }
        lastError = d.error || 'Circle Wallet setup failed'
      } catch(e) {
        lastError = e instanceof Error ? e.message : 'Circle Wallet setup failed'
        console.error('wallet connect attempt error:', e)
      }
      await new Promise(x=>setTimeout(x,2000))
    }
    setCircleWallet(null)
    setWalletSetupError(lastError || 'Circle Wallet setup failed. Please retry.')
    return false
  }

  const handleConnect = async (addr:string) => {
    const normalized = addr.toLowerCase()
    if (connectInFlightRef.current === normalized) return
    connectInFlightRef.current = normalized
    setWalletSetupError('')
    setAddress(addr)
    fetchEoaBal(addr)
    setLoadingWallet(true)
    try {
      const token = await ensureAuthSession(addr)
      await loadCircleWallet(addr, token)
    } catch(e) {
      const msg = e instanceof Error ? e.message : 'Wallet login signature failed'
      clearAuthSession()
      setAddress(null)
      setCircleWallet(null)
      setLoadingWallet(false)
      setWalletSetupError(msg)
      return
    } finally {
      connectInFlightRef.current = ''
      setLoadingWallet(false)
    }
  }
  const retryCircleWallet = async () => {
    if (!address) return
    setWalletSetupError('')
    setLoadingWallet(true)
    await loadCircleWallet(address)
    setLoadingWallet(false)
  }
  const handleDisconnect = () => { clearAuthSession(); setWalletSetupError(''); setAddress(null); setCircleWallet(null); setBalances({...EMPTY_BAL}); setEoaBalances({...EMPTY_BAL}) }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('page') === 'docs') navigate('docs')
    if (params.get('to')) setPage('send')
    const onPopState = () => setPage(currentPageFromLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    let cancelled = false
    const checkApi = async () => {
      setApiStatus('checking')
      for (let i = 0; i < 3; i++) {
        try {
          const response = await fetch(`${API}/api/config`, { cache: 'no-store' })
          if (response.ok) {
            if (!cancelled) setApiStatus('online')
            return
          }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 700 * (i + 1)))
      }
      if (!cancelled) setApiStatus('offline')
    }
    checkApi()
    const timer = setInterval(checkApi, 45000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!circleWallet?.address) return
    let iv: ReturnType<typeof setInterval> | null = null
    const stop = () => {
      if (iv) clearInterval(iv)
      iv = null
    }
    const start = () => {
      if (!iv && !document.hidden) iv = setInterval(refresh, 15000)
    }
    const onVisibilityChange = () => {
      if (document.hidden) stop()
      else {
        refresh()
        start()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stop()
    }
  }, [circleWallet, address, refresh])

  const content = routeMode === 'pay-sandbox'
    ? <PaySandbox />
    : routeMode === 'pay-checkout'
      ? <PayCheckout address={address} onConnect={handleConnect} onRefresh={refresh} />
      : renderPage({ page, address, circleWallet, balances, eoaBalances, loadingWallet, walletSetupError, retryCircleWallet, refresh, navigate, t })

  const pageTitle = routeMode === 'pay-sandbox' ? 'ARCOX Pay Sandbox' : routeMode === 'pay-checkout' ? 'ARCOX Pay Checkout' : titleFor(page)

  return (
    <div className='app-shell page-layout'>
      {routeMode === 'normal' && (
        <div className={`mobile-drawer ${drawerOpen ? 'open' : ''}`}>
          <button type='button' className='drawer-backdrop' aria-label='Close menu' onClick={() => setDrawerOpen(false)} />
          <aside className='drawer-panel glass'>
            <div className='side-brand'><ArcoxLogo /><div><strong>ARCOX</strong><span>Arc Testnet</span></div></div>
            <nav>
              {NAV.map(item => (
                <button key={item.id} type='button' className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}>
                  <span>{item.icon}</span>{item.label}
                </button>
              ))}
            </nav>
          </aside>
        </div>
      )}

      <main className={routeMode === 'normal' ? 'page-main' : 'page-main pay-main'}>
        <header className='glass app-header page-header'>
          <div className='header-row'>
            <div className='brand-row'>
              {routeMode === 'normal' && <button type='button' className='menu-button' onClick={() => setDrawerOpen(true)} aria-label='Open navigation'>☰</button>}
              <ArcoxLogo />
              <span className='brand-title'>{pageTitle}</span>
              <span className='env-pill'>{t('app.testnet')}</span>
              <span className={`api-health ${apiStatus}`}>API {apiStatus}</span>
            </div>
            <div className='header-actions'>
              <div className={`language-menu ${languageOpen ? 'open' : ''}`}>
                <button type='button' className='language-trigger' onClick={() => setLanguageOpen(v => !v)} aria-expanded={languageOpen} aria-label='Language'>
                  {lang === 'zh' ? '中文' : lang.toUpperCase()} ▾
                </button>
                <div className='language-menu-list'>
                  {LANGUAGES.map(item => (
                  <button
                    key={item.code}
                    type='button'
                    className={lang === item.code ? 'active' : ''}
                    onClick={() => { setLang(item.code); setLanguageOpen(false) }}
                    aria-pressed={lang === item.code}
                    title={item.label}
                  >
                    <span>{item.code === 'zh' ? '中文' : item.code.toUpperCase()}</span>
                    <small>{item.label}</small>
                  </button>
                  ))}
                </div>
              </div>
              <WalletButton address={address} onConnect={handleConnect} onDisconnect={handleDisconnect} />
            </div>
          </div>
        </header>

        <section className={routeMode === 'normal' ? 'page-content' : 'docs-page-wrap'}>
          {content}
          <p className='app-footer'>Powered by <a href='https://arc.network'>Arc Network</a> & <a href='https://developers.circle.com'>Circle App Kit</a></p>
        </section>
      </main>
    </div>
  )
}

function renderPage(args: {
  page: PageId
  address: string | null
  circleWallet: {id:string;address:string}|null
  balances: Record<string,string>
  eoaBalances: Record<string,string>
  loadingWallet: boolean
  walletSetupError: string
  retryCircleWallet: () => void
  refresh: () => void
  navigate: (page: PageId) => void
  t: any
}) {
  const { page, address, circleWallet, balances, eoaBalances, loadingWallet, walletSetupError, retryCircleWallet, refresh, navigate, t } = args
  if (page === 'intro') return <IntroPage address={address} walletSetupError={walletSetupError} navigate={navigate} t={t} />
  if (page === 'docs') return <DocsPanel />
  if (!address) return <ConnectRequired walletSetupError={walletSetupError} t={t} />
  if (page === 'portfolio') return <PortfolioPage address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} loadingWallet={loadingWallet} walletSetupError={walletSetupError} retryCircleWallet={retryCircleWallet} refresh={refresh} />
  if (page === 'swap') return <SwapPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />
  if (page === 'bridge') return <BridgePanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />
  if (page === 'send') return <SendPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />
  if (page === 'receive') return <ReceivePanel address={address} circleWallet={circleWallet} />
  if (page === 'agentic') return <AgenticPanel address={address} eoaBalances={eoaBalances} onRefresh={refresh} />
  if (page === 'info') return <InfoPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />
  return null
}

function IntroPage({ address, walletSetupError, navigate, t }: { address: string|null; walletSetupError: string; navigate: (page: PageId) => void; t: any }) {
  return (
    <div className='page-grid intro-grid'>
      <section className='glass welcome-card'>
        <div className='welcome-logo'><ArcoxLogo /></div>
        <h2>{address ? 'ARCOX DEX Console' : t('app.welcomeTitle')}</h2>
        <p>{address ? 'Swap, bridge, send, receive, ARCOX Pay, and agent workflows on Arc Testnet.' : t('app.welcomeCopy')}</p>
        {[
          ['1', t('app.stepConnectTitle'), t('app.stepConnectDesc')],
          ['2', t('app.stepCircleTitle'), t('app.stepCircleDesc')],
          ['3', t('app.stepFundTitle'), t('app.stepFundDesc')],
          ['4', t('app.stepTradeTitle'), t('app.stepTradeDesc')],
        ].map(([n,title,desc])=>(
          <div key={n} className='welcome-step'>
            <div className='welcome-step-number'>{n}</div>
            <div><div className='welcome-step-title'>{title}</div><div className='welcome-step-desc'>{desc}</div></div>
          </div>
        ))}
        {walletSetupError && <div className='inline-error'>{walletSetupError}</div>}
      </section>
      <section className='glass action-board'>
        <h3>Quick Actions</h3>
        <button onClick={() => navigate('portfolio')}>Portfolio</button>
        <button onClick={() => navigate('swap')}>Swap</button>
        <button onClick={() => navigate('bridge')}>Bridge</button>
        <button onClick={() => navigate('send')}>Send</button>
        <button onClick={() => navigate('receive')}>Receive / Invoice</button>
      </section>
    </div>
  )
}

function ConnectRequired({ walletSetupError, t }: { walletSetupError: string; t: any }) {
  return (
    <div className='glass welcome-card'>
      <div className='welcome-logo'><ArcoxLogo /></div>
      <h2>{t('app.welcomeTitle')}</h2>
      <p>{t('app.welcomeCopy')}</p>
      {walletSetupError && <div className='inline-error'>{walletSetupError}</div>}
    </div>
  )
}

function PortfolioPage({ address, circleWallet, balances, eoaBalances, loadingWallet, walletSetupError, retryCircleWallet, refresh }: {
  address: string
  circleWallet: {id:string;address:string}|null
  balances: Record<string,string>
  eoaBalances: Record<string,string>
  loadingWallet: boolean
  walletSetupError: string
  retryCircleWallet: () => void
  refresh: () => void
}) {
  return (
    <div className='portfolio-page'>
      <section className='glass portfolio-card wallet-card'>
        <div>
          <span>MetaMask EOA</span>
          <strong>{address.slice(0,6)}...{address.slice(-4)}</strong>
        </div>
        <div>
          <span>Circle Wallet</span>
          {circleWallet ? <strong>{circleWallet.address.slice(0,6)}...{circleWallet.address.slice(-4)}</strong> : loadingWallet ? <strong>Preparing...</strong> : <button onClick={retryCircleWallet}>Retry setup</button>}
        </div>
        {walletSetupError && <div className='inline-error'>{walletSetupError}</div>}
      </section>
      <section className='portfolio-grid'>
        {[
          ['E-USDC', eoaBalances.USDC, '#e2e8f0'],
          ['E-EURC', eoaBalances.EURC, '#e2e8f0'],
          ['E-USYC', eoaBalances.USYC, '#10b981'],
          ['E-cirBTC', eoaBalances.cirBTC, '#f7931a'],
          ['C-USDC', balances.USDC, '#c7d2fe'],
          ['C-EURC', balances.EURC, '#c7d2fe'],
          ['C-USYC', balances.USYC, '#10b981'],
          ['C-cirBTC', balances.cirBTC, '#f7931a'],
        ].map(([label, value, color]) => (
          <div className='glass portfolio-card' key={label}>
            <span>{label}</span>
            <strong style={{color}}>{Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: String(label).includes('BTC') ? 8 : 6 })}</strong>
          </div>
        ))}
      </section>
      <button type='button' className='btn btn-primary' onClick={refresh}>Refresh Balances</button>
    </div>
  )
}
