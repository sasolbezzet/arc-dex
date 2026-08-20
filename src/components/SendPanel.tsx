import { useEffect, useRef, useState } from 'react'
import { safePost } from '../api'
import { CompactTokenPicker } from './CompactPickers'
import { SEND_TOKENS } from '../domain/tokens'
import { estimateSendTokenFromEoa, sendTokenFromEoa } from '../services/eoaTransactions'
import { useI18n } from '../i18n'
import { txHistory } from '../txHistory'
const API = ''
type Status = { type:'success'|'error'; msg:string; link?:string }
type FeeQuote = { fee:string; token:string; detail?:string; platformFee?:{amount:string;token:string;bps:number}; recipientReceives?:string }
interface Props { address:string|null; circleWallet:{id:string;address:string}|null; balances:Record<string,string>; eoaBalances:Record<string,string>; onRefresh:()=>void }
export function SendPanel({ address, circleWallet, balances, eoaBalances, onRefresh }: Props) {
  const { t } = useI18n()
  const [source, setSource] = useState<'circle'|'eoa'>('circle')
  const [token, setToken] = useState('USDC')
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status|null>(null)
  const [feeQuote, setFeeQuote] = useState<FeeQuote|null>(null)
  const [feeLoading, setFeeLoading] = useState(false)
  const feeTimer = useRef<any>(null)
  const activeBal = source==='circle' ? balances : eoaBalances
  const maxBal = activeBal[token] ? parseFloat(activeBal[token]).toFixed(6) : '0'
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const to = params.get('to')
    const requestToken = params.get('token')
    const requestAmount = params.get('amount')
    if (to && to.startsWith('0x') && to.length === 42) setToAddress(to)
    if (requestToken && SEND_TOKENS.includes(requestToken as any)) setToken(requestToken)
    if (requestAmount) setAmount(requestAmount)
  }, [])
  useEffect(() => {
    clearTimeout(feeTimer.current)
    setFeeQuote(null)
    if (!address || !amount || !toAddress || !toAddress.startsWith('0x') || toAddress.length !== 42 || parseFloat(amount) <= 0) return
    feeTimer.current = setTimeout(async () => {
      setFeeLoading(true)
      try {
        if (source === 'eoa') {
          const q = await estimateSendTokenFromEoa({ from: address, to: toAddress, amount, token })
          setFeeQuote({ fee: q.fee, token: q.token, detail: `${q.gas} gas` })
        } else if (circleWallet) {
          const q = await safePost(API, '/api/send-estimate', { metamaskAddress: address, toAddress, amount, token, source })
          setFeeQuote({
            fee: q.fee || q.estimatedFee || '-',
            token: q.token || 'USDC',
            detail: q.detail || q.gas || 'App Kit estimate',
            platformFee: q.platformFee,
            recipientReceives: q.recipientReceives,
          })
        }
      } catch(e) {
        setFeeQuote({ fee: '-', token: 'USDC', detail: e instanceof Error ? e.message : 'Estimate failed' })
      }
      setFeeLoading(false)
    }, 600)
    return () => clearTimeout(feeTimer.current)
  }, [address, amount, toAddress, token, source, circleWallet])
  const handleSend = async () => {
    if (!address || !amount || !toAddress) return
    if (source === 'circle' && !circleWallet) return
    if (!toAddress.startsWith('0x') || toAddress.length!==42) { setStatus({type:'error',msg:t('send.invalidAddress')}); return }
    setLoading(true); setStatus(null)
    try {
      const result = source === 'eoa'
        ? await sendTokenFromEoa({ from: address, to: toAddress, amount, token })
        : (await safePost(API, '/api/send', {metamaskAddress:address,toAddress,amount,token,source})).result
      txHistory.add({
        id: `send-${Date.now()}-${(result?.txHash || result?.transactionHash || toAddress).slice(-6)}`,
        ts: Date.now(),
        action: 'send',
        source: 'web-ui',
        walletSource: source,
        from: source === 'circle' ? (circleWallet?.address || 'Circle Wallet') : address,
        to: toAddress,
        amount,
        token,
        status: 'success',
        tx: result?.txHash || result?.transactionHash,
        explorer: result?.explorerUrl,
        note: source === 'circle'
          ? `Send from Circle Wallet proxy via web UI. Platform fee ${result?.platformFee?.amount || '0'} ${token}; recipient receives ${result?.amount || amount} ${token}.`
          : 'Send from EOA wallet via web UI.',
      })
      setStatus({ type:'success', msg:t('send.success', { amount, token, to: toAddress.slice(0,8) }), link:result?.explorerUrl })
      setAmount(''); setToAddress('')
      setTimeout(onRefresh,3000)
    } catch(e:any) { setStatus({type:'error',msg:e?.message||t('send.failed')}) }
    setLoading(false)
  }
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>{t('send.from')}</label>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>setSource('circle')} style={{flex:1,padding:'10px 8px',borderRadius:10,border:`1px solid ${source==='circle'?'rgba(99,102,241,0.5)':'#1e1e2e'}`,background:source==='circle'?'rgba(99,102,241,0.1)':'transparent',color:source==='circle'?'#818cf8':'#64748b',cursor:'pointer',fontSize:12,fontWeight:600,textAlign:'left'}}>
            <div>🔵 {t('wallet.circle')}</div>
            <div style={{fontSize:10,marginTop:2,fontFamily:'monospace',color:'#64748b'}}>{circleWallet?.address.slice(0,8)}...{circleWallet?.address.slice(-4)}</div>
            <div style={{color:source==='circle'?'#818cf8':'#64748b',marginTop:2}}>{parseFloat(balances[token]||'0').toFixed(4)} {token}</div>
          </button>
          <button onClick={()=>setSource('eoa')} style={{flex:1,padding:'10px 8px',borderRadius:10,border:`1px solid ${source==='eoa'?'rgba(245,158,11,0.5)':'#1e1e2e'}`,background:source==='eoa'?'rgba(245,158,11,0.1)':'transparent',color:source==='eoa'?'#f59e0b':'#64748b',cursor:'pointer',fontSize:12,fontWeight:600,textAlign:'left'}}>
            <div>🟡 MetaMask (EOA)</div>
            <div style={{fontSize:10,marginTop:2,fontFamily:'monospace',color:'#64748b'}}>{address?.slice(0,8)}...{address?.slice(-4)}</div>
            <div style={{color:source==='eoa'?'#f59e0b':'#64748b',marginTop:2}}>{parseFloat(eoaBalances[token]||'0').toFixed(4)} {token}</div>
          </button>
        </div>
      </div>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
          <label style={{color:'#64748b',fontSize:13}}>{t('send.tokenAmount')}</label>
          <button onClick={()=>setAmount(maxBal)} style={{color:source==='circle'?'#818cf8':'#f59e0b',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0}}>{t('common.max')}: {parseFloat(maxBal).toFixed(4)}</button>
        </div>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder='0.00' value={amount} onChange={e=>setAmount(e.target.value)} />
          <CompactTokenPicker value={token} options={SEND_TOKENS} onChange={setToken} />
        </div>
      </div>
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>{t('send.destination')}</label>
        <input className='input' type='text' placeholder='0x...' value={toAddress} onChange={e=>setToAddress(e.target.value)} style={{fontFamily:'monospace',fontSize:12}} />
        <div style={{display:'flex',gap:6,marginTop:6}}>
          {circleWallet&&<button onClick={()=>setToAddress(circleWallet.address)} style={{fontSize:10,background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',padding:'3px 8px',borderRadius:6,cursor:'pointer'}}>{`→ ${t('wallet.circle')}`}</button>}
          {address&&<button onClick={()=>setToAddress(address)} style={{fontSize:10,background:'rgba(245,158,11,0.1)',color:'#f59e0b',border:'1px solid rgba(245,158,11,0.3)',padding:'3px 8px',borderRadius:6,cursor:'pointer'}}>{`→ ${t('wallet.personal')}`}</button>}
        </div>
      </div>
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12,display:'flex',flexDirection:'column',gap:3}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.network')}</span><span>Arc Testnet</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.from')}</span><span style={{color:source==='circle'?'#818cf8':'#f59e0b',fontFamily:'monospace',fontSize:11}}>{source==='circle'?circleWallet?.address.slice(0,8):address?.slice(0,8)}...{source==='circle'?circleWallet?.address.slice(-6):address?.slice(-4)}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('send.estimateFee')}</span><span style={{color:'#10b981'}}>{feeLoading ? t('send.calculating') : feeQuote ? `${feeQuote.fee} ${feeQuote.token}` : '-'}</span></div>
        {source === 'circle' && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.fee')} (platform)</span><span style={{color:'#f59e0b'}}>{feeQuote?.platformFee ? `${feeQuote.platformFee.amount} ${feeQuote.platformFee.token}` : '-'}</span></div>}
        {source === 'circle' && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('common.to')}</span><span>{feeQuote?.recipientReceives ? `${feeQuote.recipientReceives} ${token}` : '-'}</span></div>}
        {feeQuote?.detail && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('send.detail')}</span><span style={{fontSize:11,color:'#94a3b8',textAlign:'right'}}>{feeQuote.detail}</span></div>}
      </div>
      {status&&<div style={{padding:10,borderRadius:10,fontSize:13,background:status.type==='success'?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.1)',color:status.type==='success'?'#10b981':'#f87171',border:status.type==='success'?'1px solid rgba(16,185,129,0.3)':'1px solid rgba(239,68,68,0.3)'}}>{status.msg}{status.link&&            <div style={{marginTop:4}}><a href={status.link} target='_blank' rel='noreferrer' style={{color:'#818cf8',fontSize:11}}>{t('info.viewExplorer')} →</a></div>}</div>}
      <button onClick={handleSend} disabled={!amount||!toAddress||loading||(source==='circle'&&!circleWallet)} className='btn btn-primary'>{loading?`⏳ ${t('common.sending')}`:amount?t('send.actionAmount', { amount, token, source: source==='circle'?'Circle':'MetaMask' }):t('send.action')}</button>
    </div>
  )
}
