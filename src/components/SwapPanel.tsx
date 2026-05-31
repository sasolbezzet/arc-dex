import { useState, useEffect, useRef } from 'react'
const API = ''
const TOKENS = ['USDC','EURC','cirBTC']
type Status = { type:'success'|'error'; msg:string; link?:string }
interface Props { address:string|null; circleWallet:{id:string;address:string}|null; balances:Record<string,string>; onRefresh:()=>void }
export function SwapPanel({ address, circleWallet, balances, onRefresh }: Props) {
  const [tokenIn, setTokenIn] = useState('USDC')
  const [tokenOut, setTokenOut] = useState('EURC')
  const [amountIn, setAmountIn] = useState('')
  const [quote, setQuote] = useState<{amountOut:string;fee:string;rate:number}|null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status|null>(null)
  const debounce = useRef<any>(null)
  const fetchQuote = async (tin:string, tout:string, amt:string) => {
    if (!amt || parseFloat(amt) <= 0) { setQuote(null); return }
    try {
      const r = await fetch(API+'/api/quote', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tokenIn:tin,tokenOut:tout,amountIn:amt}) })
      const d = await r.json()
      if (d.amountOut) setQuote(d)
    } catch {}
  }
  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => fetchQuote(tokenIn, tokenOut, amountIn), 600)
  }, [tokenIn, tokenOut, amountIn])
  const handleSwap = async () => {
    if (!address || !amountIn || !circleWallet) return
    setLoading(true); setStatus(null)
    try {
      const r = await fetch(API+'/api/swap', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({metamaskAddress:address,tokenIn,tokenOut,amountIn}) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setStatus({ type:'success', msg:`✓ ${d.result?.amountIn} ${d.result?.tokenIn} → ${d.result?.amountOut} ${d.result?.tokenOut}`, link:d.result?.explorerUrl })
      setAmountIn(''); setQuote(null)
      setTimeout(onRefresh,3000); setTimeout(onRefresh,8000)
    } catch(e:any) { setStatus({ type:'error', msg:e?.message||'Swap gagal' }) }
    setLoading(false)
  }
  const maxBal = balances[tokenIn] ? parseFloat(balances[tokenIn]).toFixed(4) : '0'
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
          <label style={{color:'#64748b',fontSize:13}}>Dari</label>
          <button onClick={()=>setAmountIn(maxBal)} style={{color:'#818cf8',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0}}>Max: {maxBal} {tokenIn}</button>
        </div>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder='0.00' value={amountIn} onChange={e=>setAmountIn(e.target.value)} />
          <select className='input' value={tokenIn} onChange={e=>{setTokenIn(e.target.value);setQuote(null)}} style={{width:110}}>{TOKENS.map(t=><option key={t}>{t}</option>)}</select>
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
          <select className='input' value={tokenOut} onChange={e=>{setTokenOut(e.target.value);setQuote(null)}} style={{width:110}}>{TOKENS.filter(t=>t!==tokenIn).map(t=><option key={t}>{t}</option>)}</select>
        </div>
      </div>
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12,display:'flex',flexDirection:'column',gap:3}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Network</span><span>Arc Testnet</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Fee</span><span>{quote?quote.fee+' USDC':'-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Rate</span><span>{quote?`1 ${tokenIn} = ${quote.rate} ${tokenOut}`:'-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Wallet</span><span style={{color:'#818cf8',fontFamily:'monospace',fontSize:11}}>{circleWallet?.address.slice(0,8)}...{circleWallet?.address.slice(-6)}</span></div>
      </div>
      {status && <div style={{padding:10,borderRadius:10,fontSize:13,background:status.type==='success'?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.1)',color:status.type==='success'?'#10b981':'#f87171',border:status.type==='success'?'1px solid rgba(16,185,129,0.3)':'1px solid rgba(239,68,68,0.3)'}}>{status.msg}{status.link&&<div style={{marginTop:4}}><a href={status.link} target='_blank' rel='noreferrer' style={{color:'#818cf8',fontSize:11}}>Explorer →</a></div>}</div>}
      {!address ? <div style={{padding:10,borderRadius:10,fontSize:13,background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',textAlign:'center'}}>Hubungkan wallet di pojok kanan atas</div>
      : <button onClick={handleSwap} disabled={!amountIn||loading||tokenIn===tokenOut} className='btn btn-primary'>{loading?'⏳ Memproses...':amountIn?`Swap ${amountIn} ${tokenIn} → ${tokenOut}`:'Swap'}</button>}
    </div>
  )
}