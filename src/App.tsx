import { useState, useEffect, useRef, useCallback } from 'react'
import { WalletButton } from './components/WalletButton'
import { SwapPanel } from './components/SwapPanel'
import { BridgePanel } from './components/BridgePanel'
import { SendPanel } from './components/SendPanel'
import { InfoPanel } from './components/InfoPanel'
import { OnboardingPanel } from './components/OnboardingPanel'
const API = ''
const TABS = [{ id:'swap', label:'Swap', icon:'⇄' },{ id:'bridge', label:'Bridge', icon:'⛓' },{ id:'send', label:'Send', icon:'→' },{ id:'info', label:'Info', icon:'ℹ' }]
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
  const [tab, setTab] = useState('swap')
  const [address, setAddress] = useState<string|null>(null)
  const [circleWallet, setCircleWallet] = useState<{id:string;address:string}|null>(null)
  const [balances, setBalances] = useState<Record<string,string>>({...EMPTY_BAL})
  const [eoaBalances, setEoaBalances] = useState<Record<string,string>>({...EMPTY_BAL})
  const [loadingWallet, setLoadingWallet] = useState(false)
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
      const CIRBTC = '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF' as `0x${string}`
      const cirDecimalsRaw = await client.readContract({ address:CIRBTC, abi:erc20Abi, functionName:'decimals' }).catch(()=>6n)
      const cirDecimals = Number(cirDecimalsRaw) || 6
      const [u,e,c] = await Promise.all([
        client.readContract({ address:USDC, abi:erc20Abi, functionName:'balanceOf', args:[addr as `0x${string}`] }).catch(()=>0n),
        client.readContract({ address:EURC, abi:erc20Abi, functionName:'balanceOf', args:[addr as `0x${string}`] }).catch(()=>0n),
        client.readContract({ address:CIRBTC, abi:erc20Abi, functionName:'balanceOf', args:[addr as `0x${string}`] }).catch(()=>0n),
      ])
      setEoaBalances({ USDC:formatUnits(u as bigint,6), EURC:formatUnits(e as bigint,6), USYC:'0', cirBTC:formatUnits(c as bigint,cirDecimals) })
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
    setAddress(addr); fetchEoaBal(addr); setLoadingWallet(true)
    for (let i=0;i<3;i++) {
      try {
        const r = await fetch(`${API}/api/wallet`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({metamaskAddress:addr}) })
        if (!r.ok) { await new Promise(x=>setTimeout(x,2000)); continue }
        const d = await r.json()
        if (d.success) { setCircleWallet(d.wallet); fetchCircleBal(d.wallet.address); break }
      } catch(e) { console.error('wallet connect attempt error:', e); await new Promise(x=>setTimeout(x,2000)) }
    }
    setLoadingWallet(false)
  }
  const handleDisconnect = () => { setAddress(null); setCircleWallet(null); setBalances({...EMPTY_BAL}); setEoaBalances({...EMPTY_BAL}) }
  useEffect(() => {
    if (!circleWallet?.address) return
    const iv = setInterval(refresh, 15000)
    return () => clearInterval(iv)
  }, [circleWallet, address, refresh])
  const hasBalance = parseFloat(balances.USDC||'0')>0 || parseFloat(balances.EURC||'0')>0 || parseFloat(eoaBalances.USDC||'0')>0 || parseFloat(eoaBalances.EURC||'0')>0 || parseFloat(eoaBalances.cirBTC||'0')>0
  return (
    <div style={{minHeight:'100vh',background:'#0a0a0f'}}>
      <header className='glass' style={{position:'sticky',top:0,zIndex:50,borderBottom:'1px solid #1e1e2e'}}>
        <div style={{maxWidth:1024,margin:'0 auto',padding:'14px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <ArcoxLogo />
            <span style={{fontWeight:'bold',color:'#e2e8f0',fontSize:16}}>ARCOX DEX</span>
            <span style={{fontSize:11,background:'rgba(99,102,241,0.2)',color:'#818cf8',padding:'2px 8px',borderRadius:100,border:'1px solid rgba(99,102,241,0.3)'}}>Testnet</span>
          </div>
          <WalletButton address={address} onConnect={handleConnect} onDisconnect={handleDisconnect} />
        </div>
        {address && circleWallet && (
          <div style={{maxWidth:1024,margin:'0 auto',padding:'0 20px 10px',display:'flex',gap:6,flexWrap:'wrap'}}>
            <div className='glass' style={{padding:'4px 10px',borderRadius:8,fontSize:11}}><span style={{color:'#64748b'}}>MetaMask: </span><span style={{color:'#f59e0b',fontFamily:'monospace'}}>{address.slice(0,6)}...{address.slice(-4)}</span></div>
            <div className='glass' style={{padding:'4px 10px',borderRadius:8,fontSize:11}}><span style={{color:'#64748b'}}>Circle: </span><span style={{color:'#818cf8',fontFamily:'monospace'}}>{circleWallet.address.slice(0,6)}...{circleWallet.address.slice(-4)}</span></div>
            {parseFloat(balances.USDC||'0')>0&&<div className='glass' style={{padding:'4px 10px',borderRadius:8,fontSize:11}}><span style={{color:'#64748b'}}>C-USDC: </span><span style={{color:'#e2e8f0',fontWeight:600}}>{parseFloat(balances.USDC).toFixed(4)}</span></div>}
            <div className='glass' style={{padding:'4px 10px',borderRadius:8,fontSize:11}}><span style={{color:'#64748b'}}>E-USDC: </span><span style={{color:'#e2e8f0',fontWeight:600}}>{parseFloat(eoaBalances.USDC).toFixed(4)}</span></div>
            <div className='glass' style={{padding:'4px 10px',borderRadius:8,fontSize:11}}><span style={{color:'#64748b'}}>E-cirBTC: </span><span style={{color:'#f7931a',fontWeight:600}}>{parseFloat(eoaBalances.cirBTC).toFixed(6)}</span></div>
            {parseFloat(balances.EURC||'0')>0&&<div className='glass' style={{padding:'4px 10px',borderRadius:8,fontSize:11}}><span style={{color:'#64748b'}}>EURC: </span><span style={{color:'#e2e8f0',fontWeight:600}}>{parseFloat(balances.EURC).toFixed(4)}</span></div>}
            {parseFloat(balances.cirBTC||'0')>0&&<div className='glass' style={{padding:'4px 10px',borderRadius:8,fontSize:11}}><span style={{color:'#64748b'}}>C-cirBTC: </span><span style={{color:'#f7931a',fontWeight:600}}>{parseFloat(balances.cirBTC).toFixed(6)}</span></div>}
          </div>
        )}
      </header>
      <div style={{textAlign:'center',padding:'28px 16px 20px'}}>
        <h1 style={{fontSize:28,fontWeight:'bold',color:'#e2e8f0',marginBottom:8}}>Swap, Bridge & Earn on <span style={{color:'#818cf8'}}>ARCOX</span></h1>
        <p style={{color:'#64748b',fontSize:13}}>Powered by Circle App Kit · CCTP v2 · USDC-native</p>
      </div>
      <div style={{maxWidth:480,margin:'0 auto',padding:'0 16px 64px'}}>
        {!address ? (
          <div className='glass' style={{borderRadius:20,padding:32,textAlign:'center'}}>
            <div style={{fontSize:48,marginBottom:16}}>👋</div>
            <div style={{display:'flex',justifyContent:'center',marginBottom:14}}><ArcoxLogo /></div>
            <h2 style={{color:'#e2e8f0',fontWeight:'bold',marginBottom:8}}>Selamat Datang di ARCOX DEX</h2>
            <p style={{color:'#64748b',fontSize:13,marginBottom:20}}>Connect wallet MetaMask untuk mulai. Circle Wallet akan otomatis dibuat.</p>
            {[['1','Connect MetaMask','Klik Connect Wallet di atas'],['2','Circle Wallet dibuat','Otomatis, tidak perlu setup'],['3','Fund wallet','Transfer USDC ke Circle Wallet'],['4','Mulai trading!','Swap, Bridge, Send USDC']].map(([n,t,d])=>(
              <div key={n} style={{display:'flex',gap:10,alignItems:'flex-start',marginBottom:12,textAlign:'left'}}>
                <div style={{width:26,height:26,borderRadius:'50%',background:'rgba(99,102,241,0.2)',border:'1px solid rgba(99,102,241,0.4)',display:'flex',alignItems:'center',justifyContent:'center',color:'#818cf8',fontWeight:'bold',fontSize:12,flexShrink:0}}>{n}</div>
                <div><div style={{color:'#e2e8f0',fontWeight:600,fontSize:13}}>{t}</div><div style={{color:'#64748b',fontSize:12}}>{d}</div></div>
              </div>
            ))}
          </div>
        ) : loadingWallet ? (
          <div className='glass' style={{borderRadius:20,padding:32,textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:12}}>⚙️</div>
            <p style={{color:'#818cf8',fontWeight:600}}>Menyiapkan Circle Wallet...</p>
            <p style={{color:'#64748b',fontSize:13,marginTop:8}}>Hanya sekali saat pertama kali connect</p>
          </div>
        ) : !hasBalance ? (
          <OnboardingPanel circleWallet={circleWallet} onRefresh={()=>circleWallet&&fetchCircleBal(circleWallet.address)} />
        ) : (
          <div className='glass' style={{borderRadius:20,overflow:'hidden'}}>
            <div style={{display:'flex',borderBottom:'1px solid #1e1e2e'}}>
              {TABS.map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:'12px 0',fontSize:12,fontWeight:600,border:'none',cursor:'pointer',background:tab===t.id?'rgba(99,102,241,0.05)':'transparent',color:tab===t.id?'#818cf8':'#64748b',borderBottom:tab===t.id?'2px solid #6366f1':'2px solid transparent'}}>
                  <span style={{marginRight:4}}>{t.icon}</span>{t.label}
                </button>
              ))}
            </div>
            <div style={{padding:20}}>
              {tab==='swap'&&<SwapPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />}
              {tab==='bridge'&&<BridgePanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />}
              {tab==='send'&&<SendPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />}
              {tab==='info'&&<InfoPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />}
            </div>
          </div>
        )}
        <p style={{textAlign:'center',fontSize:11,color:'#64748b',marginTop:16}}>Powered by <a href='https://arc.network' style={{color:'#818cf8'}}>Arc Network</a> & <a href='https://developers.circle.com' style={{color:'#818cf8'}}>Circle App Kit</a></p>
      </div>
    </div>
  )
}
