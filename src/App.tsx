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
import { IntelPanel } from './components/IntelPanel'
import { UnifiedBalancePanel } from './components/UnifiedBalancePanel'
import { AiRouterPanel } from './components/AiRouterPanel'
import { getUnifiedBalanceWithAppKit } from './appKit'
import { LANGUAGES, useI18n } from './i18n'
import { clearAuthSession, ensureAuthSession, getAuthToken } from './auth'
import { ViewportPopover } from './components/ViewportPopover'
import { listAgentIdentities, selectAgentIdentity, type AgentIdentity } from './services/agentIdentity'
import { txHistory } from './txHistory'

const API = ''
const EMPTY_BAL = { USDC:'0', EURC:'0', USYC:'0', cirBTC:'0' }

const NAV = [
  { id: 'intro', path: '/', label: 'Home', icon: 'IN' },
  { id: 'portfolio', path: '/portfolio', label: 'Balances', icon: 'PF' },
  { id: 'swap', path: '/swap', label: 'Swap', icon: 'SW' },
  { id: 'bridge', path: '/bridge', label: 'Bridge', icon: 'BR' },
  { id: 'send', path: '/send', label: 'Send', icon: 'SE' },
  { id: 'receive', path: '/receive', label: 'Request', icon: 'RC' },
  { id: 'unified', path: '/unified-balance', label: 'Unified Balance', icon: 'UB' },
  { id: 'ai-router', path: '/ai-router', label: 'AI Router', icon: 'AR' },
  { id: 'agentic', path: '/agent-jobs', label: 'Jobs', icon: 'AI' },
  { id: 'intel', path: '/intel', label: 'x402', icon: 'IX' },
  { id: 'info', path: '/info', label: 'Info', icon: 'IF' },
  { id: 'docs', path: '/docs', label: 'Docs', icon: 'DX' },
] as const

type PageId = typeof NAV[number]['id']

function ArcoxLogo() {
  return (
    <div className='arcox-logo' aria-hidden='true'>
      <div className='arcox-logo-ring' />
      <div className='arcox-logo-core' />
      <div className='arcox-logo-node' />
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
  const languageTriggerRef = useRef<HTMLButtonElement>(null)
  const [address, setAddress] = useState<string|null>(null)
  const [circleWallet, setCircleWallet] = useState<{id:string;address:string}|null>(null)
  const [balances, setBalances] = useState<Record<string,string>>({...EMPTY_BAL})
  const [eoaBalances, setEoaBalances] = useState<Record<string,string>>({...EMPTY_BAL})
  const [loadingWallet, setLoadingWallet] = useState(false)
  const [walletSetupError, setWalletSetupError] = useState('')
  const [apiStatus, setApiStatus] = useState<'checking'|'online'|'offline'>('checking')
  const [agentIdentities, setAgentIdentities] = useState<AgentIdentity[]>([])
  const [activeAgentIdentity, setActiveAgentIdentity] = useState<AgentIdentity|null>(null)
  const connectInFlightRef = useRef('')

  useEffect(() => {
    txHistory.setOwner(address)
  }, [address])

  const routeMode = ['/pay/status', '/pay/sandbox'].includes(window.location.pathname)
    ? 'pay-console'
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

  const refreshAgentIdentities = useCallback(async (refresh = false) => {
    if (!address) {
      setAgentIdentities([])
      setActiveAgentIdentity(null)
      return
    }
    const data = await listAgentIdentities(address, refresh)
    setAgentIdentities(data.identities || [])
    setActiveAgentIdentity(data.activeAgentIdentity || null)
  }, [address])

  const chooseAgentIdentity = useCallback(async (agentId:string) => {
    if (!address) return
    await ensureAuthSession(address)
    const data = await selectAgentIdentity(address, agentId)
    setActiveAgentIdentity(data.activeAgentIdentity)
  }, [address])

  useEffect(() => {
    const timer = window.setTimeout(() => refreshAgentIdentities().catch(() => {
      setAgentIdentities([])
      setActiveAgentIdentity(null)
    }), 0)
    return () => window.clearTimeout(timer)
  }, [refreshAgentIdentities])
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

  const content = routeMode === 'pay-console'
    ? <PaySandbox />
    : routeMode === 'pay-checkout'
      ? <PayCheckout address={address} onConnect={handleConnect} onRefresh={refresh} />
      : page === 'intro'
        ? <IntroPage walletSetupError={walletSetupError} navigate={navigate} t={t} />
        : page === 'docs'
          ? <DocsPanel />
          : !address
            ? <ConnectRequired walletSetupError={walletSetupError} t={t} />
            : page === 'portfolio'
              ? <PortfolioPage address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} loadingWallet={loadingWallet} walletSetupError={walletSetupError} retryCircleWallet={retryCircleWallet} refresh={refresh} />
              : page === 'swap'
                ? <SwapPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />
                : page === 'bridge'
                  ? <BridgePanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />
                  : page === 'send'
                    ? <SendPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />
                    : page === 'receive'
                      ? <ReceivePanel address={address} circleWallet={circleWallet} />
                      : page === 'unified'
                        ? <UnifiedBalancePanel eoaAddress={address} />
                      : page === 'ai-router'
                        ? <AiRouterPanel address={address} activeAgentIdentity={activeAgentIdentity} />
                      : page === 'agentic'
                        ? <AgenticPanel address={address} eoaBalances={eoaBalances} onRefresh={refresh} identities={agentIdentities} activeIdentity={activeAgentIdentity} onSelectIdentity={chooseAgentIdentity} onIdentityRefresh={() => refreshAgentIdentities(true)} />
                        : page === 'intel'
                          ? <IntelPanel address={address} activeAgentIdentity={activeAgentIdentity} />
                          : page === 'info'
                            ? <InfoPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />
                            : null

  const pageTitle = routeMode === 'pay-console' ? 'ARCOX Pay Status' : routeMode === 'pay-checkout' ? 'ARCOX Pay Checkout' : titleFor(page)

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
                  <span className='nav-mark'>{item.icon}</span>{item.label}
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
              {routeMode === 'normal' && (
                <button type='button' className='menu-button' onClick={() => setDrawerOpen(true)} aria-label='Open navigation'>
                  <span />
                  <span />
                  <span />
                </button>
              )}
              <ArcoxLogo />
              <span className='brand-title'>{pageTitle}</span>
              <span className={`env-pill ${apiStatus}`} title={`API ${apiStatus}`}>{t('app.testnet')}</span>
            </div>
            <div className='header-actions'>
              <div className={`language-menu ${languageOpen ? 'open' : ''}`}>
                <button ref={languageTriggerRef} type='button' className='language-trigger' onClick={() => setLanguageOpen(v => !v)} aria-haspopup='listbox' aria-expanded={languageOpen} aria-label='Language'>
                  <span>{lang === 'zh' ? '中文' : lang.toUpperCase()}</span>
                </button>
                <ViewportPopover open={languageOpen} anchorRef={languageTriggerRef} onClose={() => setLanguageOpen(false)} preferredWidth={176} className='language-menu-popover'>
                  <div role='listbox' aria-label='Select language'>
                  {LANGUAGES.map(item => (
                  <button
                    key={item.code}
                    type='button'
                    className={lang === item.code ? 'active' : ''}
                    onClick={() => { setLang(item.code); setLanguageOpen(false) }}
                    role='option'
                    aria-selected={lang === item.code}
                    title={item.label}
                  >
                    <span>{item.code === 'zh' ? '中文' : item.code.toUpperCase()}</span>
                    <small>{item.label}</small>
                  </button>
                  ))}
                  </div>
                </ViewportPopover>
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

function IntroPage({ walletSetupError, navigate, t }: { walletSetupError: string; navigate: (page: PageId) => void; t: any }) {
  return (
    <div className='page-grid intro-grid'>
      <section className='glass welcome-card'>
        <div className='welcome-logo'><ArcoxLogo /></div>
        <div className='intro-eyebrow'>ARCOX DEX</div>
        <h2>{t('app.homeTitle')}</h2>
        <p>{t('app.homeCopy')}</p>
        {[
          ['1', t('app.stepConnectTitle'), t('app.stepConnectDesc')],
          ['2', t('app.stepFundTitle'), t('app.stepFundDesc')],
          ['3', t('app.stepTradeTitle'), t('app.stepTradeDesc')],
        ].map(([n,title,desc])=>(
          <div key={n} className='welcome-step'>
            <div className='welcome-step-number'>{n}</div>
            <div><div className='welcome-step-title'>{title}</div><div className='welcome-step-desc'>{desc}</div></div>
          </div>
        ))}
        {walletSetupError && <div className='inline-error'>{walletSetupError}</div>}
      </section>
      <section className='glass action-board'>
        <div className='intro-eyebrow'>{t('app.startHere')}</div>
        <h3>{t('app.chooseAction')}</h3>
        <button onClick={() => navigate('portfolio')}><strong>{t('app.actionBalances')}</strong><span>{t('app.actionBalancesDesc')}</span></button>
        <button onClick={() => navigate('swap')}><strong>{t('app.actionExchange')}</strong><span>{t('app.actionExchangeDesc')}</span></button>
        <button onClick={() => navigate('bridge')}><strong>{t('app.actionMove')}</strong><span>{t('app.actionMoveDesc')}</span></button>
        <button onClick={() => navigate('send')}><strong>{t('app.actionSend')}</strong><span>{t('app.actionSendDesc')}</span></button>
        <button onClick={() => navigate('receive')}><strong>{t('app.actionRequest')}</strong><span>{t('app.actionRequestDesc')}</span></button>
        <button onClick={() => navigate('ai-router')}><strong>{t('app.actionAi')}</strong><span>{t('app.actionAiDesc')}</span></button>
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
  const [unifiedBalance, setUnifiedBalance] = useState<any>(null)
  const [unifiedError, setUnifiedError] = useState('')
  const [loadingUnified, setLoadingUnified] = useState(false)

  async function refreshUnifiedBalance() {
    try {
      setLoadingUnified(true)
      setUnifiedError('')
      setUnifiedBalance(await getUnifiedBalanceWithAppKit())
    } catch (error) {
      setUnifiedError(error instanceof Error ? error.message : 'Unified Balance check failed')
    } finally {
      setLoadingUnified(false)
    }
  }

  const renderBalance = (label: string, value: string | undefined, color: string, decimals = 6) => (
    <div className='glass portfolio-card' key={label}>
      <span>{label}</span>
      <strong style={{color}}>{Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: decimals })}</strong>
    </div>
  )

  return (
    <div className='portfolio-page'>
      <section className='glass portfolio-card wallet-card'>
        <div>
          <span>Connected Wallet</span>
          <strong>{address.slice(0,6)}...{address.slice(-4)}</strong>
        </div>
        <div>
          <span>Circle Wallet</span>
          {circleWallet ? <strong>{circleWallet.address.slice(0,6)}...{circleWallet.address.slice(-4)}</strong> : loadingWallet ? <strong>Preparing...</strong> : <button onClick={retryCircleWallet}>Retry setup</button>}
        </div>
        {walletSetupError && <div className='inline-error'>{walletSetupError}</div>}
      </section>
      <section className='portfolio-section'>
        <div className='portfolio-section-head'>
          <div>
            <h3>Personal Wallet</h3>
            <p>Funds held directly in your connected wallet.</p>
          </div>
          <span>MetaMask</span>
        </div>
        <div className='portfolio-grid'>
          {renderBalance('USDC', eoaBalances.USDC, '#e2e8f0')}
          {renderBalance('EURC', eoaBalances.EURC, '#e2e8f0')}
          {renderBalance('USYC', eoaBalances.USYC, '#10b981')}
          {renderBalance('cirBTC', eoaBalances.cirBTC, '#f7931a', 8)}
        </div>
      </section>
      <section className='portfolio-section'>
        <div className='portfolio-section-head'>
          <div>
            <h3>Circle Wallet</h3>
            <p>Funds available in your ARCOX Circle wallet.</p>
          </div>
          <span>Circle</span>
        </div>
        <div className='portfolio-grid'>
          {renderBalance('USDC', balances.USDC, '#c7d2fe')}
          {renderBalance('EURC', balances.EURC, '#c7d2fe')}
          {renderBalance('USYC', balances.USYC, '#10b981')}
          {renderBalance('cirBTC', balances.cirBTC, '#f7931a', 8)}
        </div>
      </section>
      <section className='portfolio-section'>
        <div className='portfolio-section-head'>
          <div>
            <h3>Unified Balance</h3>
            <p>Your deposited USDC available across supported networks.</p>
          </div>
          <span>Deposited</span>
        </div>
        <div className='portfolio-grid'>
          {renderBalance('USDC', formatUnifiedBalanceValue(unifiedBalance), '#fbbf24')}
          <div className='glass portfolio-card'>
            <span>Networks</span>
            <strong>{formatUnifiedChainCount(unifiedBalance)}</strong>
          </div>
        </div>
        {unifiedError && <div className='inline-error'>{unifiedError}</div>}
        <button type='button' className='btn btn-secondary' onClick={refreshUnifiedBalance} disabled={loadingUnified}>
          {loadingUnified ? 'Checking...' : 'Refresh Unified Balance'}
        </button>
      </section>
      <button type='button' className='btn btn-primary' onClick={refresh}>Refresh Balances</button>
    </div>
  )
}

function formatUnifiedBalanceValue(balance: any) {
  const total = balance?.totalConfirmedBalance ?? balance?.totalBalance ?? balance?.total ?? balance?.balance ?? balance?.amount
  if (total !== undefined && total !== null) return String(total)
  const entries = unifiedBalanceEntries(balance)
  const sum = entries.reduce((acc: number, item: any) => acc + Number(item?.confirmedBalance || item?.balance || item?.amount || item?.total || 0), 0)
  return Number.isFinite(sum) ? sum.toFixed(6) : '0'
}

function formatUnifiedChainCount(balance: any) {
  const entries = unifiedBalanceEntries(balance)
  return entries.length ? `${entries.length} chain${entries.length > 1 ? 's' : ''}` : 'Check'
}

function unifiedBalanceEntries(balance: any) {
  if (Array.isArray(balance?.balances)) return balance.balances
  if (Array.isArray(balance?.chainBalances)) return balance.chainBalances
  if (Array.isArray(balance?.breakdown)) {
    return balance.breakdown.flatMap((source: any) => Array.isArray(source?.breakdown) ? source.breakdown : [])
  }
  return []
}
