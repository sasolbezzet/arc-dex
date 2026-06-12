import { useEffect, useMemo, useState } from 'react'
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
  const [receiverAddress, setReceiverAddress] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const receiveAddress = target === 'circle' ? circleWallet?.address : address
  const merchantAddress = receiverAddress || receiveAddress || ''

  useEffect(() => {
    if (receiveAddress && !receiverAddress) setReceiverAddress(receiveAddress)
  }, [receiveAddress, receiverAddress])

  const requestLink = useMemo(() => {
    if (!merchantAddress) return ''
    const url = new URL('/send', window.location.origin)
    url.searchParams.set('to', merchantAddress)
    url.searchParams.set('token', token)
    if (amount) url.searchParams.set('amount', amount)
    else url.searchParams.delete('amount')
    if (memo) url.searchParams.set('memo', memo)
    else url.searchParams.delete('memo')
    return url.toString()
  }, [merchantAddress, token, amount, memo])
  const qrUrl = requestLink ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(requestLink)}` : ''
  const copy = async (text:string, key:string) => {
    try { await navigator.clipboard.writeText(text) } catch {}
    setCopied(key)
    setTimeout(()=>setCopied(null), 1800)
  }
  const createPayInvoice = async () => {
    if (!merchantAddress) return
    setInvoiceError('')
    try {
      const invoice = await createInvoice({
        amount,
        token: 'USDC',
        network: 'arc-testnet',
        merchantAddress,
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
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>Receiver wallet</label>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <button onClick={()=>{setTarget('eoa'); if (address) setReceiverAddress(address); setShowPreview(false)}} style={{padding:'10px 8px',borderRadius:8,cursor:'pointer',border:target==='eoa'?'1px solid rgba(245,158,11,0.75)':'1px solid #1e1e2e',background:target==='eoa'?'rgba(245,158,11,0.14)':'rgba(18,18,26,0.8)',color:target==='eoa'?'#fbbf24':'#64748b',fontSize:12,fontWeight:600}}>MetaMask EOA</button>
          <button onClick={()=>{setTarget('circle'); if (circleWallet?.address) setReceiverAddress(circleWallet.address); setShowPreview(false)}} disabled={!circleWallet} style={{padding:'10px 8px',borderRadius:8,cursor:circleWallet?'pointer':'not-allowed',border:target==='circle'?'1px solid rgba(99,102,241,0.75)':'1px solid #1e1e2e',background:target==='circle'?'rgba(99,102,241,0.16)':'rgba(18,18,26,0.8)',color:target==='circle'?'#c7d2fe':'#64748b',fontSize:12,fontWeight:600}}>Circle Wallet</button>
        </div>
      </div>
      <div className='glass' style={{padding:12,borderRadius:10}}>
        <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>Receiver / merchant address</div>
        <input className='input' value={receiverAddress} onChange={event => { setReceiverAddress(event.target.value); setShowPreview(false) }} placeholder='0x receiver wallet on Arc Testnet' style={{fontFamily:'monospace',fontSize:12}} />
        {merchantAddress && <button onClick={()=>copy(merchantAddress,'addr')} style={{marginTop:8,width:'100%',background:'rgba(99,102,241,0.12)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',padding:'8px',borderRadius:8,cursor:'pointer',fontSize:12}}>{copied==='addr'?t('common.copied'):t('common.copyAddress')}</button>}
      </div>
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>Payment request</label>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder={t('receive.amountPlaceholder')} value={amount} onChange={e=>{setAmount(e.target.value); setShowPreview(false)}} />
          <CompactTokenPicker value={token} options={SEND_TOKENS} onChange={setToken} />
        </div>
        <input className='input' placeholder={t('receive.memoPlaceholder')} value={memo} onChange={e=>{setMemo(e.target.value); setShowPreview(false)}} style={{marginTop:8}} />
      </div>
      {requestLink && (
        <div className='glass' style={{padding:12,borderRadius:10,textAlign:'center'}}>
          <img src={qrUrl} alt='Payment request QR' width={176} height={176} style={{borderRadius:8,background:'#fff',padding:8,maxWidth:'100%',height:'auto'}} />
          <button onClick={()=>copy(requestLink,'link')} style={{marginTop:10,width:'100%',background:'rgba(15,23,42,0.72)',color:'#cbd5e1',border:'1px solid rgba(148,163,184,0.2)',padding:'10px',borderRadius:10,cursor:'pointer',fontSize:13,fontWeight:600}}>{copied==='link'?t('receive.linkCopied'):'Copy classic send link'}</button>
          <button onClick={()=>setShowPreview(true)} disabled={!amount || token !== 'USDC' || !merchantAddress} style={{marginTop:8,width:'100%',background:'rgba(8,145,178,0.18)',color:'#67e8f9',border:'1px solid rgba(8,145,178,0.32)',padding:'10px',borderRadius:10,cursor:amount && token === 'USDC' && merchantAddress?'pointer':'not-allowed',fontSize:13,fontWeight:600}}>Preview ARCOX Pay Invoice</button>
          {showPreview && (
            <div className='pay-preview' style={{textAlign:'left'}}>
              <h3>Payment Preview</h3>
              <div className='pay-grid'>
                <Info label='Buyer pays' value={`${amount} USDC`} />
                <Info label='Merchant receives' value={`${amount} USDC on Arc Testnet`} />
                <Info label='Receiver wallet' value={merchantAddress} mono />
                <Info label='Memo' value={memo || '-'} />
              </div>
              <button onClick={createPayInvoice} style={{marginTop:8,width:'100%',background:'rgba(34,197,94,0.14)',color:'#86efac',border:'1px solid rgba(34,197,94,0.3)',padding:'10px',borderRadius:10,cursor:'pointer',fontSize:13,fontWeight:600}}>Create payment link</button>
            </div>
          )}
          {invoiceLink && <button onClick={()=>{ window.location.href = invoiceLink }} style={{marginTop:8,width:'100%',background:'rgba(34,197,94,0.14)',color:'#86efac',border:'1px solid rgba(34,197,94,0.3)',padding:'10px',borderRadius:10,cursor:'pointer',fontSize:13,fontWeight:600}}>Lihat preview pembayaran</button>}
          {invoiceError && <div className='inline-error'>{invoiceError}</div>}
        </div>
      )}
      <div style={{fontSize:11,color:'#64748b',textAlign:'center'}}>{t('receive.help')}</div>
    </div>
  )
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className='pay-info'>
      <span>{label}</span>
      <strong className={mono ? 'mono' : ''}>{value}</strong>
    </div>
  )
}
