import { useState, useEffect, useRef } from 'react'
import { useI18n } from '../i18n'
import { getAuthToken } from '../auth'
declare global { interface Window { ethereum?: any } }
interface Props { address: string|null; onConnect:(a:string)=>void; onDisconnect:()=>void }
export function WalletButton({ address, onConnect, onDisconnect }: Props) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const onConnectRef = useRef(onConnect)
  const onDisconnectRef = useRef(onDisconnect)
  useEffect(() => {
    onConnectRef.current = onConnect
    onDisconnectRef.current = onDisconnect
  })
  useEffect(() => {
    if (!window.ethereum) return
    window.ethereum.request({ method: 'eth_accounts' }).then((a: string[]) => {
      if (a[0] && getAuthToken()) onConnectRef.current(a[0])
    })
    const handler = (a: string[]) => { if (a[0]) onConnectRef.current(a[0]); else onDisconnectRef.current() }
    window.ethereum.on('accountsChanged', handler)
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', handler)
    }
  }, [])
  const connect = async () => {
    setError(''); setLoading(true)
    if (!window.ethereum) { setError(t('wallet.installMetamask')); setLoading(false); return }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      onConnect(accounts[0])
    } catch(e:any) { setError(e?.message || t('wallet.connectFailed')) }
  setLoading(false)
  }
  if (address) return (
    <div className='wallet-connected'>
      <div className='glass' style={{padding:'6px 12px',borderRadius:10,fontSize:12}}>
        <span style={{color:'#64748b'}}>{t('wallet.connected')} </span>
        <span style={{color:'#818cf8',fontFamily:'monospace'}}>{address.slice(0,6)}...{address.slice(-4)}</span>
      </div>
      <button onClick={onDisconnect} style={{background:'rgba(239,68,68,0.2)',color:'#f87171',border:'1px solid rgba(239,68,68,0.3)',padding:'6px 12px',borderRadius:10,cursor:'pointer',fontSize:12}}>{t('wallet.disconnect')}</button>
    </div>
  )
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,minWidth:0}}>
      <button onClick={connect} disabled={loading} className='btn btn-primary' style={{width:'auto',padding:'8px 20px',fontSize:13}}>
        {loading ? t('wallet.connecting') : t('wallet.connect')}
      </button>
      {error && <span className='wallet-error'>{error}</span>}
    </div>
  )
}
