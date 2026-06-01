import { useState, useEffect, useRef } from 'react'
import { safePost } from '../api'
import { swapEoaWithAppKit } from '../appKit'
import { CompactTokenPicker } from './CompactPickers'
const API = ''
const TOKENS = ['USDC','EURC','cirBTC']
type Status = { type:'success'|'error'|'warning'; msg:string; link?:string }
interface Props { address:string|null; circleWallet:{id:string;address:string}|null; balances:Record<string,string>; eoaBalances:Record<string,string>; onRefresh:()=>void }
export function SwapPanel({ address, circleWallet, balances, eoaBalances, onRefresh }: Props) {
  const [source, setSource] = useState<'circle'|'eoa'>('circle')
  const [tokenIn, setTokenIn] = useState('USDC')
  const [tokenOut, setTokenOut] = useState('EURC')
  const [amountIn, setAmountIn] = useState('')
  const [quote, setQuote] = useState<{amountOut:string;fee:string;rate:number}|null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status|null>(null)
  const debounce = useRef<any>(null)
  const kitKeyRef = useRef<string>('')
  const getKitKey = async () => {
    if (kitKeyRef.current) return kitKeyRef.current
    const r = await fetch(`${API}/api/config`)
    const d = await r.json()
    kitKeyRef.current = d.kitKey || ''
    return kitKeyRef.current
  }
  const fetchQuote = async (tin:string, tout:string, amt:string) => {
    if (!amt || parseFloat(amt) <= 0) { setQuote(null); return }
    try {
      const d = await safePost(API, '/api/quote', {metamaskAddress:address,tokenIn:tin,tokenOut:tout,amountIn:amt})
      if (d.available === false) {
        setQuote(null)
        setStatus({ type:'warning', msg:d.error || 'Route swap belum tersedia untuk pasangan/jumlah ini.' })
        return
      }
      if (d.amountOut) {
        setStatus(null)
        setQuote(d)
      }
    } catch(e) { console.error('fetchQuote error:', e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => fetchQuote(tokenIn, tokenOut, amountIn), 600)
  }, [tokenIn, tokenOut, amountIn])
  const handleSwap = async () => {
    if (!address || !amountIn) return
    setLoading(true); setStatus(null)
    try {
      if (source === 'eoa') {
        const kitKey = await getKitKey()
        const result = await swapEoaWithAppKit({ tokenIn, tokenOut, amountIn, kitKey })
        setStatus({ type:'success', msg:`✓ ${result?.amountIn || amountIn} ${tokenIn} → ${result?.amountOut || result?.estimatedOutput?.amount || ''} ${tokenOut}`, link:result?.explorerUrl })
      } else {
        if (!circleWallet) return
        const d = await safePost(API, '/api/swap', {metamaskAddress:address,tokenIn,tokenOut,amountIn})
        if (d.available === false) {
          setStatus({ type:'warning', msg:d.error || 'Route swap belum tersedia untuk pasangan/jumlah ini.' })
          return
        }
        setStatus({ type:'success', msg:`✓ ${d.result?.amountIn} ${d.result?.tokenIn} → ${d.result?.amountOut} ${d.result?.tokenOut}`, link:d.result?.explorerUrl })
      }
      setAmountIn(''); setQuote(null)
      setTimeout(onRefresh,3000); setTimeout(onRefresh,8000)
    } catch(e:any) { setStatus({ type:'error', msg:e?.message||'Swap gagal' }) }
    setLoading(false)
  }
  const activeBalances = source === 'circle' ? balances : eoaBalances
  const maxBal = activeBalances[tokenIn] ? parseFloat(activeBalances[tokenIn]).toFixed(4) : '0'
  const walletLabel = source === 'circle' ? 'Circle Wallet' : 'EOA MetaMask'
  const walletAddr = source === 'circle' ? circleWallet?.address : address
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <button onClick={()=>setSource('circle')} style={{padding:'10px 8px',borderRadius:8,cursor:'pointer',border:source==='circle'?'1px solid rgba(99,102,241,0.75)':'1px solid #1e1e2e',background:source==='circle'?'rgba(99,102,241,0.16)':'rgba(18,18,26,0.8)',color:source==='circle'?'#c7d2fe':'#64748b',fontSize:12,fontWeight:600}}>Circle Wallet</button>
        <button onClick={()=>setSource('eoa')} style={{padding:'10px 8px',borderRadius:8,cursor:'pointer',border:source==='eoa'?'1px solid rgba(245,158,11,0.75)':'1px solid #1e1e2e',background:source==='eoa'?'rgba(245,158,11,0.14)':'rgba(18,18,26,0.8)',color:source==='eoa'?'#fbbf24':'#64748b',fontSize:12,fontWeight:600}}>EOA Wallet</button>
      </div>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
          <label style={{color:'#64748b',fontSize:13}}>Dari</label>
          <button onClick={()=>setAmountIn(maxBal)} style={{color:'#818cf8',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0}}>Max: {maxBal} {tokenIn}</button>
        </div>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder='0.00' value={amountIn} onChange={e=>setAmountIn(e.target.value)} />
          <CompactTokenPicker value={tokenIn} options={TOKENS} onChange={t=>{setTokenIn(t);setQuote(null)}} />
        </div>
      </div>
      <div style={{textAlign:'center'}}>
        <button onClick={()=>{setTokenIn(tokenOut);setTokenOut(tokenIn);setQuote(null)}} className='glass' style={{padding:'6px 14px',borderRadius:10,cursor:'pointer',color:'#818cf8',fontSize:18,border:'1px solid #1e1e2e',background:'rgba(18,18,26,0.8)'}}>⇅</button>
      </div>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
          <label style={{color:'#64748b',fontSize:13}}>Ke</label>
          {quote && <span style={{color:'#10b981',fontSize:12}}>≈ {quote.amountOut} {tokenOut}</span>}
        </div>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder='estimasi...' value={quote?.amountOut||''} disabled style={{opacity:0.7}} />
          <CompactTokenPicker value={tokenOut} options={TOKENS.filter(t=>t!==tokenIn)} onChange={t=>{setTokenOut(t);setQuote(null)}} />
        </div>
      </div>
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12,display:'flex',flexDirection:'column',gap:3}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Network</span><span>Arc Testnet</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Fee</span><span>{quote?quote.fee+' USDC':'-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Rate</span><span>{quote?`1 ${tokenIn} = ${quote.rate} ${tokenOut}`:'-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Sumber</span><span>{walletLabel}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Wallet</span><span style={{color:source==='circle'?'#818cf8':'#f59e0b',fontFamily:'monospace',fontSize:11}}>{walletAddr?.slice(0,8)}...{walletAddr?.slice(-6)}</span></div>
      </div>
      {status && <div style={{padding:10,borderRadius:10,fontSize:13,background:status.type==='success'?'rgba(16,185,129,0.1)':status.type==='warning'?'rgba(245,158,11,0.1)':'rgba(239,68,68,0.1)',color:status.type==='success'?'#10b981':status.type==='warning'?'#f59e0b':'#f87171',border:status.type==='success'?'1px solid rgba(16,185,129,0.3)':status.type==='warning'?'1px solid rgba(245,158,11,0.3)':'1px solid rgba(239,68,68,0.3)'}}>{status.msg}{status.link&&<div style={{marginTop:4}}><a href={status.link} target='_blank' rel='noreferrer' style={{color:'#818cf8',fontSize:11}}>Explorer →</a></div>}</div>}
      {!address ? <div style={{padding:10,borderRadius:10,fontSize:13,background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',textAlign:'center'}}>Hubungkan wallet di pojok kanan atas</div>
      : <button onClick={handleSwap} disabled={!amountIn||loading||tokenIn===tokenOut||(source==='circle'&&!circleWallet)} className='btn btn-primary'>{loading?'⏳ Memproses...':amountIn?`Swap ${amountIn} ${tokenIn} → ${tokenOut} dari ${source==='circle'?'Circle':'EOA'}`:'Swap'}</button>}
    </div>
  )
}
