import { useState, useEffect, useRef } from 'react'
import { CompactTokenPicker } from './CompactPickers'
import { SWAP_TOKENS } from '../domain/tokens'
import { quoteCircleSwap, quoteEoaSwap, swapFromCircleWallet, swapFromEoa } from '../services/swapService'
import { useI18n } from '../i18n'
import { txHistory } from '../txHistory'

type Status = { type:'success'|'error'|'warning'; msg:string; link?:string }
interface Props { address:string|null; circleWallet:{id:string;address:string}|null; balances:Record<string,string>; eoaBalances:Record<string,string>; onRefresh:()=>void }
export function SwapPanel({ address, circleWallet, balances, eoaBalances, onRefresh }: Props) {
  const { t } = useI18n()
  // The reliable cirBTC route is a direct EOA→pool transaction. Circle Wallet
  // cannot submit arbitrary pool calls through its Stablecoin Service adapter.
  const [source, setSource] = useState<'circle'|'eoa'>('eoa')
  const [tokenIn, setTokenIn] = useState('USDC')
  // Circle's Stablecoin Service routing is flaky on Arc Testnet for USDC↔EURC.
  // The on-chain AMM router (USDC↔cirBTC) is the reliable default route.
  const [tokenOut, setTokenOut] = useState('cirBTC')
  const [amountIn, setAmountIn] = useState('')
  const [quote, setQuote] = useState<{amountOut:string;fee:string;rate:number;platformFee?:{amount:string;token:string;swapAmountIn:string;bps:number}}|null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status|null>(null)
  const debounce = useRef<any>(null)
  const fetchQuote = async (src:'circle'|'eoa', tin:string, tout:string, amt:string) => {
    if (!amt || parseFloat(amt) <= 0 || tin === tout) { setQuote(null); return }
    if (src === 'circle' && (!address || !circleWallet)) { setQuote(null); return }
    if (src === 'eoa' && !address) { setQuote(null); return }
    setQuoteLoading(true)
    try {
      const d = src === 'eoa'
        ? await quoteEoaSwap({metamaskAddress:address,tokenIn:tin,tokenOut:tout,amountIn:amt})
        : await quoteCircleSwap({metamaskAddress:address,tokenIn:tin,tokenOut:tout,amountIn:amt})
      if (d.available === false) {
        setQuote(null)
        const hint = tokenIn === 'USDC' && tokenOut === 'EURC'
          ? ` ${t('swap.routeUnavailableHint', { fallback: 'Coba USDC ↔ cirBTC (route AMM on-chain).' })}`
          : ''
        setStatus({ type:'warning', msg:(d.error || t('swap.routeUnavailable')) + hint })
        setQuoteLoading(false)
        return
      }
      if (d.amountOut) {
        setStatus(null)
        setQuote(d)
      }
    } catch(e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('fetchQuote error:', msg)
      setQuote(null)
      setStatus({ type:'warning', msg })
    }
    setQuoteLoading(false)
  }
  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => fetchQuote(source, tokenIn, tokenOut, amountIn), 600)
  }, [source, tokenIn, tokenOut, amountIn])
  const handleSwap = async () => {
    if (!address || !amountIn) return
    setLoading(true); setStatus(null)
    try {
      if (source === 'eoa') {
        setStatus({ type:'warning', msg:'USDC hanya perlu 1 popup transaksi. Token lain mungkin meminta izin lebih dulu.' })
        const result = await swapFromEoa({ metamaskAddress: address, tokenIn, tokenOut, amountIn })
        const feeText = result?.platformFee?.amount ? ` • fee ${result.platformFee.amount} ${result.platformFee.token}` : ''
        txHistory.add({
          id: `swap-${Date.now()}-${(result?.txHash || result?.transactionHash || tokenOut).slice(-6)}`,
          ts: Date.now(),
          action: 'swap',
          source: 'web-ui',
          walletSource: 'eoa',
          from: tokenIn,
          to: tokenOut,
          amount: result?.amountIn || amountIn,
          token: tokenIn,
          status: 'success',
          tx: result?.txHash || result?.transactionHash,
          explorer: result?.explorerUrl,
          note: `EOA swap to ${result?.amountOut || result?.raw?.estimatedOutput?.amount || ''} ${tokenOut}. Platform fee ${result?.platformFee?.amount || '0'} ${tokenIn}${result?.platformFee?.error ? ` failed: ${result.platformFee.error}` : ''}.`,
        })
        const feeWarning = result?.platformFee?.error ? `\nPlatform fee gagal: ${result.platformFee.error}` : ''
        setStatus({ type:'success', msg:`✓ ${result?.amountIn || amountIn} ${tokenIn} → ${result?.amountOut || result?.raw?.estimatedOutput?.amount || ''} ${tokenOut}${feeText}${feeWarning}`, link:result?.explorerUrl })
      } else {
        if (!circleWallet) return
        const d = await swapFromCircleWallet({metamaskAddress:address,tokenIn,tokenOut,amountIn})
        if (d.available === false) {
          setStatus({ type:'warning', msg:(d.error || t('swap.routeUnavailable')) + (tokenIn === 'USDC' && tokenOut === 'cirBTC' ? ' Pilih Personal Wallet untuk route AMM on-chain.' : '') })
          return
        }
        const feeText = d.result?.platformFee?.amount ? ` • fee ${d.result.platformFee.amount} ${d.result.platformFee.token}` : ''
        txHistory.add({
          id: `swap-${Date.now()}-${(d.result?.txHash || d.result?.transactionHash || tokenOut).slice(-6)}`,
          ts: Date.now(),
          action: 'swap',
          source: 'web-ui',
          walletSource: 'circle',
          from: tokenIn,
          to: tokenOut,
          amount: d.result?.amountIn || amountIn,
          token: tokenIn,
          status: 'success',
          tx: d.result?.txHash || d.result?.transactionHash,
          explorer: d.result?.explorerUrl,
          note: `Circle Wallet swap to ${d.result?.amountOut || ''} ${tokenOut}${feeText}.`,
        })
        setStatus({ type:'success', msg:`✓ ${d.result?.amountIn} ${d.result?.tokenIn} → ${d.result?.amountOut} ${d.result?.tokenOut}${feeText}`, link:d.result?.explorerUrl })
      }
      setAmountIn(''); setQuote(null)
      setTimeout(onRefresh,3000); setTimeout(onRefresh,8000)
    } catch(e:any) { setStatus({ type:'error', msg:e?.message||'Swap gagal' }) }
    setLoading(false)
  }
  const activeBalances = source === 'circle' ? balances : eoaBalances
  const maxBal = activeBalances[tokenIn] ? parseFloat(activeBalances[tokenIn]).toFixed(4) : '0'
  const walletLabel = source === 'circle' ? 'Circle Wallet' : 'Personal Wallet'
  const walletAddr = source === 'circle' ? circleWallet?.address : address
  const swapDisabled = !amountIn || !quote || quoteLoading || loading || tokenIn === tokenOut || (source === 'circle' && !circleWallet)
  const swapLabel = loading
    ? `⏳ ${t('common.processing')}`
    : quoteLoading
      ? 'Mengambil estimasi...'
      : amountIn
          ? t('swap.actionAmount', { amount: amountIn, tokenIn, tokenOut, source: source === 'circle' ? 'Circle' : 'EOA' })
          : t('swap.action')
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <button onClick={()=>setSource('circle')} style={{padding:'10px 8px',borderRadius:8,cursor:'pointer',border:source==='circle'?'1px solid rgba(99,102,241,0.75)':'1px solid #1e1e2e',background:source==='circle'?'rgba(99,102,241,0.16)':'rgba(18,18,26,0.8)',color:source==='circle'?'#c7d2fe':'#64748b',fontSize:12,fontWeight:600}}>Circle Wallet</button>
        <button onClick={()=>setSource('eoa')} style={{padding:'10px 8px',borderRadius:8,cursor:'pointer',border:source==='eoa'?'1px solid rgba(245,158,11,0.75)':'1px solid #1e1e2e',background:source==='eoa'?'rgba(245,158,11,0.14)':'rgba(18,18,26,0.8)',color:source==='eoa'?'#fbbf24':'#64748b',fontSize:12,fontWeight:600}}>Personal Wallet</button>
      </div>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
          <label style={{color:'#64748b',fontSize:13}}>{t('common.from')}</label>
          <button onClick={()=>setAmountIn(maxBal)} style={{color:'#818cf8',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0}}>{t('common.max')}: {maxBal} {tokenIn}</button>
        </div>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder='0.00' value={amountIn} onChange={e=>setAmountIn(e.target.value)} />
          <CompactTokenPicker value={tokenIn} options={SWAP_TOKENS} onChange={t=>{setTokenIn(t);setQuote(null)}} />
        </div>
      </div>
      <div style={{textAlign:'center'}}>
        <button onClick={()=>{setTokenIn(tokenOut);setTokenOut(tokenIn);setQuote(null)}} className='glass' style={{padding:'6px 14px',borderRadius:10,cursor:'pointer',color:'#818cf8',fontSize:18,border:'1px solid #1e1e2e',background:'rgba(18,18,26,0.8)'}}>⇅</button>
      </div>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
          <label style={{color:'#64748b',fontSize:13}}>{t('common.to')}</label>
          {quote && <span style={{color:'#10b981',fontSize:12}}>≈ {quote.amountOut} {tokenOut}</span>}
        </div>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder='estimasi...' value={quote?.amountOut||''} disabled style={{opacity:0.7}} />
          <CompactTokenPicker value={tokenOut} options={SWAP_TOKENS.filter(t=>t!==tokenIn)} onChange={t=>{setTokenOut(t);setQuote(null)}} />
        </div>
      </div>
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12,display:'flex',flexDirection:'column',gap:3}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.network')}</span><span>Arc Testnet</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Platform fee</span><span>{quote?.platformFee ? `${quote.platformFee.amount} ${quote.platformFee.token}` : '-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Swap input</span><span>{quote?.platformFee ? `${quote.platformFee.swapAmountIn} ${tokenIn}` : '-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.fee')}</span><span>{quote?quote.fee+' USDC':'-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.rate')}</span><span>{quote?`1 ${tokenIn} = ${quote.rate} ${tokenOut}`:'-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.source')}</span><span>{walletLabel}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.wallet')}</span><span style={{color:source==='circle'?'#818cf8':'#f59e0b',fontFamily:'monospace',fontSize:11}}>{walletAddr?.slice(0,8)}...{walletAddr?.slice(-6)}</span></div>
      </div>
      {quoteLoading && <div style={{padding:10,borderRadius:10,fontSize:12,background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',textAlign:'center'}}>Mengambil estimasi swap...</div>}
      {status && <div style={{padding:10,borderRadius:10,fontSize:13,background:status.type==='success'?'rgba(16,185,129,0.1)':status.type==='warning'?'rgba(245,158,11,0.1)':'rgba(239,68,68,0.1)',color:status.type==='success'?'#10b981':status.type==='warning'?'#f59e0b':'#f87171',border:status.type==='success'?'1px solid rgba(16,185,129,0.3)':status.type==='warning'?'1px solid rgba(245,158,11,0.3)':'1px solid rgba(239,68,68,0.3)'}}>{status.msg}{status.link&&<div style={{marginTop:4}}><a href={status.link} target='_blank' rel='noreferrer' style={{color:'#818cf8',fontSize:11}}>Explorer →</a></div>}</div>}
      {!address ? <div style={{padding:10,borderRadius:10,fontSize:13,background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',textAlign:'center'}}>{t('swap.connectWalletHint')}</div>
      : <button onClick={handleSwap} disabled={swapDisabled} className='btn btn-primary'>{swapLabel}</button>}
    </div>
  )
}
