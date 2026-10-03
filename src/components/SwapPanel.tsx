import { useState, useEffect, useRef } from 'react'
import { CompactChainPicker, CompactTokenPicker, formatTokenLabel } from './CompactPickers'
import { SWAP_TOKENS } from '../domain/tokens'
import { quoteCircleSwap, quoteEoaSwap, swapFromCircleWallet, swapFromEoa, type SwapChainMeta } from '../services/swapService'
import { getAuthToken } from '../auth'
import { useI18n } from '../i18n'
import { flowErrorText } from '../services/flowErrors'
import { txHistory } from '../txHistory'

type Status = { type:'success'|'error'|'warning'; msg:string; link?:string }
interface Props { address:string|null; circleWallet:{id:string;address:string}|null; balances:Record<string,string>; eoaBalances:Record<string,string>; onRefresh:()=>void }

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

function sameToken(a:string, b:string) {
  return a.toLowerCase() === b.toLowerCase()
}

function displayAmount(value: string) {
  const num = Number(String(value || '0').replace(/,/g, ''))
  if (!Number.isFinite(num) || num <= 0) return '0'
  return num.toLocaleString('en-US', { maximumFractionDigits: 8, useGrouping: false })
}

export function SwapPanel({ address, circleWallet, balances, eoaBalances, onRefresh }: Props) {
  const { t } = useI18n()
  // Swap dari Personal Wallet menjalankan transaksi di browser; swap dari
  // Circle Wallet dieksekusi server memakai wallet custodial per chain.
  const [source, setSource] = useState<'circle'|'eoa'>('eoa')
  const [chains, setChains] = useState<SwapChainMeta[]>([])
  const [chainKey, setChainKey] = useState('')
  const [tokenIn, setTokenIn] = useState('USDC')
  const [tokenOut, setTokenOut] = useState('EURC')
  const [customTokens, setCustomTokens] = useState<string[]>([])
  const [importCa, setImportCa] = useState('')
  const [importError, setImportError] = useState('')
  const [amountIn, setAmountIn] = useState('')
  const [quote, setQuote] = useState<{amountOut:string;fee:string;rate:number;platformFee?:{amount:string;token:string;swapAmountIn:string;bps:number}}|null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status|null>(null)
  const [remoteBal, setRemoteBal] = useState<{key:string;tokens:Record<string,string>}|null>(null)
  const debounce = useRef<any>(null)
  const quoteRequestRef = useRef(0)
  const activeChain = chains.find(chain => chain.key === chainKey) || chains[0] || null
  const activeChainKey = activeChain?.key || ''
  const balanceKey = `${source}:${activeChainKey}`

  // Daftar chain swap (mainnet: Arc, Ethereum, Base, Arbitrum) datang dari
  // backend supaya UI tidak pernah menawarkan chain yang tidak didukung API.
  useEffect(() => {
    let cancelled = false
    fetch('/api/swap/chains', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !Array.isArray(data?.chains) || data.chains.length === 0) return
        setChains(data.chains)
        setChainKey(current => data.chains.some((chain: SwapChainMeta) => chain.key === current) ? current : data.chains[0].key)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const handleChainChange = (next: string) => {
    const chain = chains.find(item => item.key === next)
    const symbols = chain?.tokens ? Object.keys(chain.tokens) : [...SWAP_TOKENS]
    setChainKey(next)
    setCustomTokens([])
    setImportCa('')
    setImportError('')
    setQuote(null)
    const first = symbols[0] || 'USDC'
    const second = symbols.find(symbol => symbol !== first) || first
    setTokenIn(first)
    setTokenOut(second)
  }

  const fetchQuote = async (src:'circle'|'eoa', tin:string, tout:string, amt:string, chain:string) => {
    const requestId = ++quoteRequestRef.current
    if (!amt || parseFloat(amt) <= 0 || sameToken(tin, tout) || !chain) { setQuote(null); return }
    if (src === 'circle' && (!address || !circleWallet)) { setQuote(null); return }
    if (src === 'eoa' && !address) { setQuote(null); return }
    setQuoteLoading(true)
    try {
      const d = src === 'eoa'
        ? await quoteEoaSwap({metamaskAddress:address,tokenIn:tin,tokenOut:tout,amountIn:amt,chain})
        : await quoteCircleSwap({metamaskAddress:address,tokenIn:tin,tokenOut:tout,amountIn:amt,chain})
      if (requestId !== quoteRequestRef.current) return
      if (d.available === false) {
        setQuote(null)
        setStatus({ type:'warning', msg:d.error || t('swap.routeUnavailable') })
        setQuoteLoading(false)
        return
      }
      if (d.amountOut) {
        setStatus(null)
        setQuote(d)
      }
    } catch(e) {
      if (requestId !== quoteRequestRef.current) return
      console.error('fetchQuote error:', e instanceof Error ? e.message : e)
      setQuote(null)
      setStatus({ type:'warning', msg: flowErrorText(t, e, 'swap') })
    }
    if (requestId === quoteRequestRef.current) setQuoteLoading(false)
  }
  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => fetchQuote(source, tokenIn, tokenOut, amountIn, activeChainKey), 600)
  }, [source, tokenIn, tokenOut, amountIn, activeChainKey])

  // Saldo chain non-Arc dibaca dari /api/balance (Arc sudah dimuat App dan
  // dipakai apa adanya). Circle Wallet chain lain dibuat on-demand agar angka
  // yang ditampilkan benar-benar milik wallet yang akan dipakai swap.
  useEffect(() => {
    if (!activeChain || activeChain.active || !address) return
    let cancelled = false
    const key = `${source}:${activeChain.key}`
    const run = async () => {
      setRemoteBal(null)
      try {
        let target = address
        if (source === 'circle') {
          if (activeChain.circleWalletSupported === false) throw new Error(`Circle Wallet belum tersedia di ${activeChain.name}. Pilih Personal Wallet.`)
          const auth = getAuthToken()
          const r = await fetch('/api/wallet', {
            method:'POST',
            headers:{'Content-Type':'application/json', ...(auth ? { Authorization:`Bearer ${auth}` } : {})},
            body: JSON.stringify({ metamaskAddress: address, chain: activeChain.key }),
          })
          const data = await r.json().catch(() => ({}))
          if (!r.ok || !data?.wallet?.address) throw new Error(data?.error || `Circle Wallet ${activeChain.name} belum siap.`)
          target = data.wallet.address
        }
        const r = await fetch(`/api/balance/${target}?chain=${encodeURIComponent(activeChain.key)}`, { cache: 'no-store' })
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data?.error || `Balance request failed (${r.status})`)
        const tokens: Record<string,string> = {}
        for (const [symbol, value] of Object.entries(data)) {
          if (typeof value === 'string') tokens[symbol] = value
        }
        if (typeof data?.nativeBalance === 'string') tokens[activeChain.nativeCurrency?.symbol || 'ETH'] = data.nativeBalance
        if (!cancelled) setRemoteBal({ key, tokens })
      } catch (e) {
        console.error('chain balance error:', e)
        if (!cancelled) setRemoteBal({ key, tokens: {} })
      }
    }
    run()
    return () => { cancelled = true }
  }, [activeChain, source, address])

  const activeBalances: Record<string,string> | null = !activeChain
    ? null
    : activeChain.active
      ? (source === 'circle' ? balances : eoaBalances)
      : (remoteBal?.key === balanceKey ? remoteBal.tokens : null)

  const importToken = () => {
    const raw = importCa.trim()
    if (!ADDRESS_RE.test(raw)) { setImportError('Alamat kontrak tidak valid (0x + 40 hex).'); return }
    if (sameToken(raw, tokenIn)) { setImportError('Alamat ini sudah dipakai sebagai token input.'); return }
    setCustomTokens(prev => prev.some(item => sameToken(item, raw)) ? prev : [...prev, raw])
    setTokenOut(raw)
    setImportCa('')
    setImportError('')
    setQuote(null)
  }

  const handleSwap = async () => {
    if (!address || !amountIn || !activeChain) return
    setLoading(true); setStatus(null)
    try {
      if (source === 'eoa') {
        setStatus({ type:'warning', msg: t('swap.onePopup') })
        const result = await swapFromEoa({ metamaskAddress: address, tokenIn, tokenOut, amountIn, chain: activeChain.key, chainMeta: activeChain })
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
          note: `EOA swap on ${activeChain.name} to ${result?.amountOut || result?.raw?.estimatedOutput?.amount || ''} ${formatTokenLabel(tokenOut)}. Platform fee ${result?.platformFee?.amount || '0'} ${formatTokenLabel(tokenIn)}${result?.platformFee?.error ? ` failed: ${result.platformFee.error}` : ''}.`,
        })
        const feeWarning = result?.platformFee?.error ? `\nPlatform fee gagal: ${result.platformFee.error}` : ''
        setStatus({ type:'success', msg:`✓ ${result?.amountIn || amountIn} ${formatTokenLabel(tokenIn)} → ${result?.amountOut || result?.raw?.estimatedOutput?.amount || ''} ${formatTokenLabel(tokenOut)}${feeText}${feeWarning}`, link:result?.explorerUrl })
      } else {
        if (activeChain.active && !circleWallet) return
        const d = await swapFromCircleWallet({metamaskAddress:address,tokenIn,tokenOut,amountIn,chain:activeChain.key})
        if (d.available === false) {
          setStatus({ type:'warning', msg:(d.error || t('swap.routeUnavailable')) })
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
          note: `Circle Wallet swap on ${activeChain.name} to ${d.result?.amountOut || ''} ${formatTokenLabel(tokenOut)}${feeText}.`,
        })
        setStatus({ type:'success', msg:`✓ ${d.result?.amountIn} ${formatTokenLabel(d.result?.tokenIn || tokenIn)} → ${d.result?.amountOut} ${formatTokenLabel(d.result?.tokenOut || tokenOut)}${feeText}`, link:d.result?.explorerUrl })
      }
      setAmountIn(''); setQuote(null)
      setTimeout(onRefresh,3000); setTimeout(onRefresh,8000)
    } catch(e:any) {
      // Jalur swap EOA berjalan di browser, jadi kegagalan wallet (popup kedua
      // yang tidak muncul, RPC wallet yang menggantung, revert yang tidak
      // terbaca) hanya bisa ditelusuri lewat objek error aslinya.
      console.error(`swap ${source} ${tokenIn}→${tokenOut} gagal:`, e)
      setStatus({ type:'error', msg: flowErrorText(t, e, 'swap') })
    }
    setLoading(false)
  }

  const chainSymbols = activeChain?.tokens ? Object.keys(activeChain.tokens) : [...SWAP_TOKENS]
  const tokenOptions = Array.from(new Set([...chainSymbols, ...customTokens]))
  const balanceValue = activeBalances?.[tokenIn]
  const balanceKnown = typeof balanceValue === 'string'
  // cirBTC butuh 8 desimal; angka lain dipotong maksimum 8 agar input Max
  // tidak pernah memuat pemisah ribuan yang merusak parser backend.
  const maxBal = balanceKnown ? displayAmount(balanceValue || '0') : ''
  const walletLabel = source === 'circle' ? t('swap.circleWallet') : t('swap.personalWallet')
  const walletAddr = source === 'circle' ? circleWallet?.address : address
  const circleUnavailable = source === 'circle' && activeChain?.circleWalletSupported === false
  const swapDisabled = !amountIn || !quote || quoteLoading || loading || sameToken(tokenIn, tokenOut) || !activeChain || (source === 'circle' && activeChain?.active === true && !circleWallet) || Boolean(circleUnavailable)
  const swapLabel = loading
    ? `⏳ ${t('common.processing')}`
    : quoteLoading
      ? t('swap.estimateLoading')
      : amountIn
          ? t('swap.actionAmount', { amount: amountIn, tokenIn: formatTokenLabel(tokenIn), tokenOut: formatTokenLabel(tokenOut), source: source === 'circle' ? 'Circle' : 'EOA' })
          : t('swap.action')
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <button onClick={()=>setSource('circle')} style={{padding:'10px 8px',borderRadius:8,cursor:'pointer',border:source==='circle'?'1px solid rgba(99,102,241,0.75)':'1px solid #1e1e2e',background:source==='circle'?'rgba(99,102,241,0.16)':'rgba(18,18,26,0.8)',color:source==='circle'?'#c7d2fe':'#64748b',fontSize:12,fontWeight:600}}>{t('swap.circleWallet')}</button>
        <button onClick={()=>setSource('eoa')} style={{padding:'10px 8px',borderRadius:8,cursor:'pointer',border:source==='eoa'?'1px solid rgba(245,158,11,0.75)':'1px solid #1e1e2e',background:source==='eoa'?'rgba(245,158,11,0.14)':'rgba(18,18,26,0.8)',color:source==='eoa'?'#fbbf24':'#64748b',fontSize:12,fontWeight:600}}>{t('swap.personalWallet')}</button>
      </div>
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>{t('common.network')}</label>
        <CompactChainPicker
          value={activeChainKey}
          options={chains.map(chain => ({ id: chain.key, label: chain.name }))}
          onChange={handleChainChange}
        />
      </div>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
          <label style={{color:'#64748b',fontSize:13}}>{t('common.from')}</label>
          <button onClick={()=>{ if (balanceKnown) setAmountIn(maxBal) }} disabled={!balanceKnown} style={{color:'#818cf8',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0,opacity:balanceKnown?1:0.5}}>{t('common.max')}: {balanceKnown ? `${maxBal} ${formatTokenLabel(tokenIn)}` : '—'}</button>
        </div>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder='0.00' value={amountIn} onChange={e=>setAmountIn(e.target.value)} />
          <CompactTokenPicker value={tokenIn} options={tokenOptions} onChange={token=>{setTokenIn(token);setQuote(null)}} />
        </div>
      </div>
      <div style={{textAlign:'center'}}>
        <button onClick={()=>{setTokenIn(tokenOut);setTokenOut(tokenIn);setQuote(null)}} className='glass' style={{padding:'6px 14px',borderRadius:10,cursor:'pointer',color:'#818cf8',fontSize:18,border:'1px solid #1e1e2e',background:'rgba(18,18,26,0.8)'}}>⇅</button>
      </div>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
          <label style={{color:'#64748b',fontSize:13}}>{t('common.to')}</label>
          {quote && <span style={{color:'#10b981',fontSize:12}}>≈ {quote.amountOut} {formatTokenLabel(tokenOut)}</span>}
        </div>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder={t('swap.estimatePlaceholder')} value={quote?.amountOut||''} disabled style={{opacity:0.7}} />
          <CompactTokenPicker value={tokenOut} options={tokenOptions.filter(option=>!sameToken(option, tokenIn))} onChange={token=>{setTokenOut(token);setQuote(null)}} />
        </div>
        <div style={{display:'flex',gap:6,marginTop:6}}>
          <input
            className='input'
            placeholder='Paste contract address token (0x…)'
            value={importCa}
            onChange={e=>{setImportCa(e.target.value);setImportError('')}}
            onKeyDown={e=>{ if (e.key === 'Enter') importToken() }}
            style={{fontSize:11}}
          />
          <button type='button' className='glass' onClick={importToken} style={{padding:'0 12px',borderRadius:8,cursor:'pointer',color:'#c7d2fe',border:'1px solid #1e1e2e',background:'rgba(18,18,26,0.8)',fontSize:12,whiteSpace:'nowrap'}}>Import</button>
        </div>
        {importError && <div style={{color:'#f87171',fontSize:11,marginTop:4}}>{importError}</div>}
      </div>
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12,display:'flex',flexDirection:'column',gap:3}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.network')}</span><span>{activeChain?.name || 'Arc Mainnet'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('swap.platformFee')}</span><span>{quote?.platformFee ? `${quote.platformFee.amount} ${formatTokenLabel(quote.platformFee.token)}` : '-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('swap.swapInput')}</span><span>{quote?.platformFee ? `${quote.platformFee.swapAmountIn} ${formatTokenLabel(tokenIn)}` : '-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.fee')}</span><span>{quote?quote.fee+' USDC':'-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.rate')}</span><span>{quote?`1 ${formatTokenLabel(tokenIn)} = ${quote.rate} ${formatTokenLabel(tokenOut)}`:'-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.source')}</span><span>{walletLabel}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.wallet')}</span><span style={{color:source==='circle'?'#818cf8':'#f59e0b',fontFamily:'monospace',fontSize:11}}>{walletAddr?.slice(0,8)}...{walletAddr?.slice(-6)}</span></div>
      </div>
      {circleUnavailable && <div style={{padding:10,borderRadius:10,fontSize:12,background:'rgba(245,158,11,0.1)',color:'#f59e0b',border:'1px solid rgba(245,158,11,0.3)'}}>{`Circle Wallet belum tersedia di ${activeChain?.name}. Pilih Personal Wallet.`}</div>}
      {quoteLoading && <div style={{padding:10,borderRadius:10,fontSize:12,background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',textAlign:'center'}}>{t('swap.estimateLoading')}</div>}
      {status && <div style={{padding:10,borderRadius:10,fontSize:13,whiteSpace:'pre-line',background:status.type==='success'?'rgba(16,185,129,0.1)':status.type==='warning'?'rgba(245,158,11,0.1)':'rgba(239,68,68,0.1)',color:status.type==='success'?'#10b981':status.type==='warning'?'#f59e0b':'#f87171',border:status.type==='success'?'1px solid rgba(16,185,129,0.3)':status.type==='warning'?'1px solid rgba(245,158,11,0.3)':'1px solid rgba(239,68,68,0.3)'}}>{status.msg}{status.link&&<div style={{marginTop:4}}><a href={status.link} target='_blank' rel='noreferrer' style={{color:'#818cf8',fontSize:11}}>Explorer →</a></div>}</div>}
      {!address ? <div style={{padding:10,borderRadius:10,fontSize:13,background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',textAlign:'center'}}>{t('swap.connectWalletHint')}</div>
      : <button onClick={handleSwap} disabled={swapDisabled} className='btn btn-primary'>{swapLabel}</button>}
    </div>
  )
}
