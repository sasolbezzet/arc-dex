import { useState, useEffect, useRef } from 'react'
import { useI18n } from '../i18n'
import { findConnectedWalletProvider, getWalletProvider, setWalletProvider } from '../walletProvider'
import { connectWalletConnect, disconnectWalletConnect, getWalletConnectProviderSync, isWalletConnectAvailable, isMobile, redirectToWalletForSign } from '../services/walletConnect'

declare global { interface Window { ethereum?: any } }

interface Props { address: string|null; onConnect:(a:string)=>void|Promise<void>; onDisconnect:()=>void }

export function WalletButton({ address, onConnect, onDisconnect }: Props) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showOptions, setShowOptions] = useState(false)
  const [mobileSignHint, setMobileSignHint] = useState(false)
  const onConnectRef = useRef(onConnect)
  const onDisconnectRef = useRef(onDisconnect)
  useEffect(() => { onConnectRef.current = onConnect; onDisconnectRef.current = onDisconnect })

  useEffect(() => {
    let provider = getWalletProvider()
    let disposed = false
    const handler = (a: string[]) => { if (a[0]) onConnectRef.current(a[0]); else onDisconnectRef.current() }
    findConnectedWalletProvider().then(async active => {
      if (disposed || !active) return
      provider = active
      active.on?.('accountsChanged', handler)
      active.on?.('chainChanged', () => { /* surface in UI */ })
    }).catch(() => {})
    return () => { disposed = true; provider?.removeListener?.('accountsChanged', handler) }
  }, [])

  // Also listen for WalletConnect provider events
  useEffect(() => {
    const wc = getWalletConnectProviderSync()
    if (!wc) return
    const handler = (a: string[]) => { if (a[0]) onConnectRef.current(a[0]); else onDisconnectRef.current() }
    wc.on?.('accountsChanged', handler)
    return () => { wc.removeListener?.('accountsChanged', handler) }
  }, [address])

  const connectInjected = async () => {
    setError(''); setLoading(true)
    const provider = getWalletProvider()
    if (!provider) { setError(t('wallet.installMetamask')); setLoading(false); return }
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' })
      setWalletProvider(provider)
      await onConnect(accounts[0])
    } catch(e:any) { setError(e?.message || t('wallet.connectFailed')) }
    setLoading(false)
  }

  const connectWC = async () => {
    setError(''); setLoading(true); setShowOptions(false); setMobileSignHint(false)
    try {
      const addr = await connectWalletConnect()
      if (addr) {
        const wcProv = getWalletConnectProviderSync()
        if (wcProv) setWalletProvider(wcProv)

        if (isMobile()) {
          // On mobile: onConnect → ensureAuthSession → personal_sign via WC relay.
          // The signing request goes to the wallet app. We need to redirect
          // the user back to the wallet to approve the signature.
          setMobileSignHint(true)
          const connectPromise = onConnect(addr)
          // Give 1.5s for the personal_sign request to reach the relay,
          // then deep-link to the wallet app.
          setTimeout(() => redirectToWalletForSign(), 1500)
          await connectPromise
          setMobileSignHint(false)
        } else {
          await onConnect(addr)
        }
      }
    } catch(e:any) {
      setMobileSignHint(false)
      setError(e?.message || 'WalletConnect gagal')
    }
    setLoading(false)
  }

  const disconnect = async () => {
    await disconnectWalletConnect()
    onDisconnect()
  }

  // Check if injected wallet (MetaMask etc) is available
  const hasInjected = Boolean((window as any).ethereum)

  if (address) return (
    <div className='wallet-connected'>
      <div className='glass' style={{padding:'6px 12px',borderRadius:10,fontSize:12}}>
        <span style={{color:'#64748b'}}>{t('wallet.connected')} </span>
        <span style={{color:'#818cf8',fontFamily:'monospace'}}>{address.slice(0,6)}...{address.slice(-4)}</span>
      </div>
      <button onClick={disconnect} style={{background:'rgba(239,68,68,0.2)',color:'#f87171',border:'1px solid rgba(239,68,68,0.3)',padding:'6px 12px',borderRadius:10,cursor:'pointer',fontSize:12}}>{t('wallet.disconnect')}</button>
    </div>
  )

  // If WalletConnect is available, show options
  if (isWalletConnectAvailable() && showOptions) return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,minWidth:0}}>
      {hasInjected && (
        <button onClick={connectInjected} disabled={loading} className='btn btn-primary' style={{width:'auto',padding:'8px 20px',fontSize:13}}>
          {loading ? '...' : '🦊 MetaMask'}
        </button>
      )}
      <button onClick={connectWC} disabled={loading} className='btn btn-primary' style={{width:'auto',padding:'8px 20px',fontSize:13,background:'rgba(99,102,241,0.8)'}}>
        {loading ? '...' : '📱 WalletConnect'}
      </button>
      <button onClick={() => setShowOptions(false)} style={{background:'none',border:'none',color:'#64748b',cursor:'pointer',fontSize:11}}>← kembali</button>
    </div>
  )

  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,minWidth:0}}>
      <button onClick={() => { if (!hasInjected && isWalletConnectAvailable()) { connectWC() } else if (hasInjected) { connectInjected() } else { setShowOptions(true) } }} disabled={loading} className='btn btn-primary' style={{width:'auto',padding:'8px 20px',fontSize:13}}>
        {loading
          ? (mobileSignHint ? '✍️ Buka wallet...' : t('wallet.connecting'))
          : t('wallet.connect')}
      </button>
      {isWalletConnectAvailable() && !showOptions && !loading && (
        <button onClick={() => setShowOptions(true)} style={{background:'none',border:'none',color:'#818cf8',cursor:'pointer',fontSize:11}}>atau pilih wallet</button>
      )}
      {mobileSignHint && (
        <span style={{color:'#fbbf24',fontSize:11,textAlign:'right'}}>Buka wallet Anda untuk tanda tangan login</span>
      )}
      {error && <span className='wallet-error'>{error}</span>}
    </div>
  )
}
