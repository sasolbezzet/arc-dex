import { useMemo, useState } from 'react'
import { CompactTokenPicker } from './CompactPickers'
import { SEND_TOKENS } from '../domain/tokens'
import { useI18n } from '../i18n'
import { createInvoice } from '../payApi'

interface Props {
  address:string|null
  circleWallet:{id:string;address:string}|null
}

export function ReceivePanel({ address, circleWallet }: Props) {
  const { t } = useI18n()
  const [target, setTarget] = useState<'eoa'|'circle'>('eoa')
  const [token, setToken] = useState('USDC')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [copied, setCopied] = useState<string|null>(null)
  const [invoiceLink, setInvoiceLink] = useState('')
  const [invoiceError, setInvoiceError] = useState('')
  const receiveAddress = target === 'circle' ? circleWallet?.address : address
  const requestLink = useMemo(() => {
    if (!receiveAddress) return ''
    const url = new URL(window.location.href)
    url.searchParams.set('to', receiveAddress)
    url.searchParams.set('token', token)
    if (amount) url.searchParams.set('amount', amount)
    else url.searchParams.delete('amount')
    if (memo) url.searchParams.set('memo', memo)
    else url.searchParams.delete('memo')
    return url.toString()
  }, [receiveAddress, token, amount, memo])
  const qrUrl = requestLink ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(requestLink)}` : ''
  const copy = async (text:string, key:string) => {
    try { await navigator.clipboard.writeText(text) } catch {}
    setCopied(key)
    setTimeout(()=>setCopied(null), 1800)
  }
  const createPayInvoice = async () => {
    if (!receiveAddress) return
    setInvoiceError('')
    try {
      const invoice = await createInvoice({
        amount,
        token: 'USDC',
        network: 'arc-testnet',
        merchantAddress: receiveAddress,
        memo,
        expiresInMinutes: 15,
      })
      setInvoiceLink(invoice.paymentUrl)
    } catch (e) {
      setInvoiceError(e instanceof Error ? e.message : 'Failed to create invoice.')
    }
  }
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>{t('receive.to')}</label>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <button onClick={()=>setTarget('eoa')} style={{padding:'10px 8px',borderRadius:8,cursor:'pointer',border:target==='eoa'?'1px solid rgba(245,158,11,0.75)':'1px solid #1e1e2e',background:target==='eoa'?'rgba(245,158,11,0.14)':'rgba(18,18,26,0.8)',color:target==='eoa'?'#fbbf24':'#64748b',fontSize:12,fontWeight:600}}>MetaMask EOA</button>
          <button onClick={()=>setTarget('circle')} disabled={!circleWallet} style={{padding:'10px 8px',borderRadius:8,cursor:circleWallet?'pointer':'not-allowed',border:target==='circle'?'1px solid rgba(99,102,241,0.75)':'1px solid #1e1e2e',background:target==='circle'?'rgba(99,102,241,0.16)':'rgba(18,18,26,0.8)',color:target==='circle'?'#c7d2fe':'#64748b',fontSize:12,fontWeight:600}}>Circle Wallet</button>
        </div>
      </div>
      <div className='glass' style={{padding:12,borderRadius:10}}>
        <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>{t('receive.address')}</div>
        <div style={{fontFamily:'monospace',fontSize:12,color:target==='circle'?'#818cf8':'#f59e0b',wordBreak:'break-all'}}>{receiveAddress || '-'}</div>
        {receiveAddress && <button onClick={()=>copy(receiveAddress,'addr')} style={{marginTop:8,width:'100%',background:'rgba(99,102,241,0.12)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',padding:'8px',borderRadius:8,cursor:'pointer',fontSize:12}}>{copied==='addr'?t('common.copied'):t('common.copyAddress')}</button>}
      </div>
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>{t('receive.request')}</label>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder={t('receive.amountPlaceholder')} value={amount} onChange={e=>setAmount(e.target.value)} />
          <CompactTokenPicker value={token} options={SEND_TOKENS} onChange={setToken} />
        </div>
        <input className='input' placeholder={t('receive.memoPlaceholder')} value={memo} onChange={e=>setMemo(e.target.value)} style={{marginTop:8}} />
      </div>
      {requestLink && (
        <div className='glass' style={{padding:12,borderRadius:10,textAlign:'center'}}>
          <img src={qrUrl} alt='Payment request QR' width={176} height={176} style={{borderRadius:8,background:'#fff',padding:8,maxWidth:'100%',height:'auto'}} />
          <button onClick={()=>copy(requestLink,'link')} style={{marginTop:10,width:'100%',background:'#4f46e5',color:'white',border:'none',padding:'10px',borderRadius:10,cursor:'pointer',fontSize:13,fontWeight:600}}>{copied==='link'?t('receive.linkCopied'):t('common.copyLink')}</button>
          <button onClick={createPayInvoice} disabled={!amount || token !== 'USDC'} style={{marginTop:8,width:'100%',background:'rgba(8,145,178,0.18)',color:'#67e8f9',border:'1px solid rgba(8,145,178,0.32)',padding:'10px',borderRadius:10,cursor:amount && token === 'USDC'?'pointer':'not-allowed',fontSize:13,fontWeight:600}}>Create ARCOX Pay Invoice</button>
          {invoiceLink && <button onClick={()=>copy(invoiceLink,'invoice')} style={{marginTop:8,width:'100%',background:'rgba(34,197,94,0.14)',color:'#86efac',border:'1px solid rgba(34,197,94,0.3)',padding:'10px',borderRadius:10,cursor:'pointer',fontSize:13,fontWeight:600}}>{copied==='invoice'?'Copied':'Copy Invoice Link'}</button>}
          {invoiceError && <div className='inline-error'>{invoiceError}</div>}
        </div>
      )}
      <div style={{fontSize:11,color:'#64748b',textAlign:'center'}}>{t('receive.help')}</div>
    </div>
  )
}
