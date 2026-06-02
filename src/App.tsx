import { useState, useEffect, useRef, useCallback } from 'react'
import { WalletButton } from './components/WalletButton'
import { SwapPanel } from './components/SwapPanel'
import { BridgePanel } from './components/BridgePanel'
import { SendPanel } from './components/SendPanel'
import { ReceivePanel } from './components/ReceivePanel'
import { InfoPanel } from './components/InfoPanel'
import { OnboardingPanel } from './components/OnboardingPanel'
import { LANGUAGES, useI18n, type Lang } from './i18n'
import { clearAuthSession, ensureAuthSession, getAuthToken } from './auth'
const API = ''
const TABS = [{ id:'swap', labelKey:'tab.swap', icon:'⇄' },{ id:'bridge', labelKey:'tab.bridge', icon:'⛓' },{ id:'send', labelKey:'tab.send', icon:'→' },{ id:'receive', labelKey:'tab.receive', icon:'↓' },{ id:'info', labelKey:'tab.info', icon:'ℹ' }] as const
const EMPTY_BAL = { USDC:'0', EURC:'0', USYC:'0', cirBTC:'0' }
function ArcoxLogo() {
  return (
    <div style={{width:36,height:36,borderRadius:10,background:'linear-gradient(135deg,#22d3ee 0%,#6366f1 48%,#f59e0b 100%)',display:'grid',placeItems:'center',boxShadow:'0 10px 28px rgba(99,102,241,0.32)',position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',inset:3,border:'1px solid rgba(255,255,255,0.38)',borderRadius:8}} />
      <div style={{width:18,height:18,border:'3px solid rgba(255,255,255,0.95)',borderLeftColor:'transparent',transform:'rotate(45deg)',borderRadius:5}} />
      <div style={{position:'absolute',width:9,height:9,borderRadius:'50%',background:'#0a0a0f',right:8,top:8,border:'2px solid rgba(255,255,255,0.9)'}} />
    </div>
  )
}
export default function App() {
  const { lang, setLang, t } = useI18n()
  const [tab, setTab] = useState('swap')
  const [address, setAddress] = useState<string|null>(null)
  const [circleWallet, setCircleWallet] = useState<{id:string;address:string}|null>(null)
  const [balances, setBalances] = useState<Record<string,string>>({...EMPTY_BAL})
  const [eoaBalances, setEoaBalances] = useState<Record<string,string>>({...EMPTY_BAL})
  const [loadingWallet, setLoadingWallet] = useState(false)
  const [walletSetupError, setWalletSetupError] = useState('')
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
  const handleConnect = async (addr:string) => {
    setWalletSetupError('')
    setAddress(addr)
    fetchEoaBal(addr)
    setLoadingWallet(true)
    try {
      await ensureAuthSession(addr)
    } catch(e) {
      const msg = e instanceof Error ? e.message : 'Wallet login signature failed'
      clearAuthSession()
      setAddress(null)
      setCircleWallet(null)
      setLoadingWallet(false)
      setWalletSetupError(msg)
      return
    }
    let walletReady = false
    for (let i=0;i<3;i++) {
      try {
        const r = await fetch(`${API}/api/wallet`, {
          method:'POST',
          headers:{'Content-Type':'application/json', Authorization:`Bearer ${getAuthToken()}`},
          body:JSON.stringify({metamaskAddress:addr}),
        })
        if (!r.ok) { await new Promise(x=>setTimeout(x,2000)); continue }
        const d = await r.json()
        if (d.success) { walletReady = true; setCircleWallet(d.wallet); fetchCircleBal(d.wallet.address); break }
      } catch(e) {
        console.error('wallet connect attempt error:', e)
        if (i === 2) setWalletSetupError(e instanceof Error ? e.message : 'Circle Wallet setup failed')
        await new Promise(x=>setTimeout(x,2000))
      }
    }
    if (!walletReady) setWalletSetupError('Circle Wallet setup failed. Please disconnect and connect again.')
    setLoadingWallet(false)
  }
  const handleDisconnect = () => { clearAuthSession(); setWalletSetupError(''); setAddress(null); setCircleWallet(null); setBalances({...EMPTY_BAL}); setEoaBalances({...EMPTY_BAL}) }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('to')) setTab('send')
  }, [])
  useEffect(() => {
    if (!circleWallet?.address) return
    const iv = setInterval(refresh, 15000)
    return () => clearInterval(iv)
  }, [circleWallet, address, refresh])
  const hasBalance = parseFloat(balances.USDC||'0')>0 || parseFloat(balances.EURC||'0')>0 || parseFloat(balances.USYC||'0')>0 || parseFloat(eoaBalances.USDC||'0')>0 || parseFloat(eoaBalances.EURC||'0')>0 || parseFloat(eoaBalances.USYC||'0')>0 || parseFloat(eoaBalances.cirBTC||'0')>0
  return (
    <div className='app-shell'>
      <header className='glass app-header'>
        <div className='header-row'>
          <div className='brand-row'>
            <ArcoxLogo />
            <span style={{fontWeight:'bold',color:'#e2e8f0',fontSize:16}}>ARCOX DEX</span>
            <span style={{fontSize:11,background:'rgba(99,102,241,0.2)',color:'#818cf8',padding:'2px 8px',borderRadius:100,border:'1px solid rgba(99,102,241,0.3)'}}>{t('app.testnet')}</span>
          </div>
          <div className='header-actions'>
            <select className='language-select' value={lang} onChange={e=>setLang(e.target.value as Lang)} aria-label='Language'>
              {LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
            <WalletButton address={address} onConnect={handleConnect} onDisconnect={handleDisconnect} />
          </div>
        </div>
        {address && circleWallet && (
          <div className='balance-strip'>
            <div className='glass chip'><span style={{color:'#64748b'}}>MetaMask: </span><span style={{color:'#f59e0b',fontFamily:'monospace'}}>{address.slice(0,6)}...{address.slice(-4)}</span></div>
            <div className='glass chip'><span style={{color:'#64748b'}}>Circle: </span><span style={{color:'#818cf8',fontFamily:'monospace'}}>{circleWallet.address.slice(0,6)}...{circleWallet.address.slice(-4)}</span></div>
            {parseFloat(balances.USDC||'0')>0&&<div className='glass chip'><span style={{color:'#64748b'}}>C-USDC: </span><span style={{color:'#e2e8f0',fontWeight:600}}>{parseFloat(balances.USDC).toFixed(4)}</span></div>}
            <div className='glass chip'><span style={{color:'#64748b'}}>E-USDC: </span><span style={{color:'#e2e8f0',fontWeight:600}}>{parseFloat(eoaBalances.USDC).toFixed(4)}</span></div>
            <div className='glass chip'><span style={{color:'#64748b'}}>E-cirBTC: </span><span style={{color:'#f7931a',fontWeight:600}}>{parseFloat(eoaBalances.cirBTC).toFixed(6)}</span></div>
            {parseFloat(eoaBalances.USYC||'0')>0&&<div className='glass chip'><span style={{color:'#64748b'}}>E-USYC: </span><span style={{color:'#10b981',fontWeight:600}}>{parseFloat(eoaBalances.USYC).toFixed(4)}</span></div>}
            {parseFloat(balances.EURC||'0')>0&&<div className='glass chip'><span style={{color:'#64748b'}}>EURC: </span><span style={{color:'#e2e8f0',fontWeight:600}}>{parseFloat(balances.EURC).toFixed(4)}</span></div>}
            {parseFloat(balances.USYC||'0')>0&&<div className='glass chip'><span style={{color:'#64748b'}}>C-USYC: </span><span style={{color:'#10b981',fontWeight:600}}>{parseFloat(balances.USYC).toFixed(4)}</span></div>}
            {parseFloat(balances.cirBTC||'0')>0&&<div className='glass chip'><span style={{color:'#64748b'}}>C-cirBTC: </span><span style={{color:'#f7931a',fontWeight:600}}>{parseFloat(balances.cirBTC).toFixed(6)}</span></div>}
          </div>
        )}
      </header>
      <div className='hero-copy'>
        <h1>{t('app.heroTitle')} <span style={{color:'#818cf8'}}>ARCOX</span></h1>
        <p>{t('app.heroSubtitle')}</p>
      </div>
      <div className='app-panel-wrap'>
        {!address ? (
          <div className='glass' style={{borderRadius:20,padding:32,textAlign:'center'}}>
            <div style={{fontSize:48,marginBottom:16}}>👋</div>
            <div style={{display:'flex',justifyContent:'center',marginBottom:14}}><ArcoxLogo /></div>
            <h2 style={{color:'#e2e8f0',fontWeight:'bold',marginBottom:8}}>{t('app.welcomeTitle')}</h2>
            <p style={{color:'#64748b',fontSize:13,marginBottom:20}}>{t('app.welcomeCopy')}</p>
            {[
              ['1', t('app.stepConnectTitle'), t('app.stepConnectDesc')],
              ['2', t('app.stepCircleTitle'), t('app.stepCircleDesc')],
              ['3', t('app.stepFundTitle'), t('app.stepFundDesc')],
              ['4', t('app.stepTradeTitle'), t('app.stepTradeDesc')],
            ].map(([n,title,desc])=>(
              <div key={n} style={{display:'flex',gap:10,alignItems:'flex-start',marginBottom:12,textAlign:'left'}}>
                <div style={{width:26,height:26,borderRadius:'50%',background:'rgba(99,102,241,0.2)',border:'1px solid rgba(99,102,241,0.4)',display:'flex',alignItems:'center',justifyContent:'center',color:'#818cf8',fontWeight:'bold',fontSize:12,flexShrink:0}}>{n}</div>
                <div><div style={{color:'#e2e8f0',fontWeight:600,fontSize:13}}>{title}</div><div style={{color:'#64748b',fontSize:12}}>{desc}</div></div>
              </div>
            ))}
            {walletSetupError && (
              <div style={{marginTop:12,padding:10,borderRadius:10,fontSize:12,background:'rgba(239,68,68,0.1)',color:'#f87171',border:'1px solid rgba(239,68,68,0.3)'}}>{walletSetupError}</div>
            )}
          </div>
        ) : loadingWallet ? (
          <div className='glass' style={{borderRadius:20,padding:32,textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:12}}>⚙️</div>
            <p style={{color:'#818cf8',fontWeight:600}}>{t('app.preparingWallet')}</p>
            <p style={{color:'#64748b',fontSize:13,marginTop:8}}>{t('app.preparingWalletDesc')}</p>
          </div>
        ) : !hasBalance ? (
          <OnboardingPanel circleWallet={circleWallet} onRefresh={()=>circleWallet&&fetchCircleBal(circleWallet.address)} />
        ) : (
          <div className='glass' style={{borderRadius:20,overflow:'hidden'}}>
            <div className='tab-bar'>
              {TABS.map(item=>(
                <button key={item.id} onClick={()=>setTab(item.id)} className={`tab-button ${tab===item.id?'active':''}`}>
                  <span style={{marginRight:4}}>{item.icon}</span>{t(item.labelKey)}
                </button>
              ))}
            </div>
            <div className='panel-body'>
              {tab==='swap'&&<SwapPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />}
              {tab==='bridge'&&<BridgePanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />}
              {tab==='send'&&<SendPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />}
              {tab==='receive'&&<ReceivePanel address={address} circleWallet={circleWallet} />}
              {tab==='info'&&<InfoPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />}
            </div>
          </div>
        )}
        <p style={{textAlign:'center',fontSize:11,color:'#64748b',marginTop:16}}>Powered by <a href='https://arc.network' style={{color:'#818cf8'}}>Arc Network</a> & <a href='https://developers.circle.com' style={{color:'#818cf8'}}>Circle App Kit</a></p>
      </div>
    </div>
  )
}
