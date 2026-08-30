import { useState, useEffect, useRef } from 'react'
import { useI18n } from '../i18n'
import { findConnectedWalletProvider, getWalletProvider, setWalletProvider } from '../walletProvider'
import { connectWalletConnect, restoreWalletConnect, disconnectWalletConnect, getWalletConnectProviderSync, isWalletConnectAvailable, isMobile, redirectToWalletForSign } from '../services/walletConnect'

declare global { interface Window { ethereum?: any } }

interface Props { address: string|null; onConnect:(a:string)=>void|Promise<void>; onDisconnect:()=>void; onConnected?:()=>void }

export function WalletButton({ address, onConnect, onDisconnect, onConnected }: Props) {
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

    // During OAuth flow (auth=mcp in URL), skip WalletConnect auto-restore
    // to prevent mobile deep-link to wallet app before user approves.
    const isOAuthFlow = new URLSearchParams(window.location.search).get('auth') === 'mcp'

    findConnectedWalletProvider().then(async active => {
      if (disposed || !active) return
      provider = active
      active.on?.('accountsChanged', handler)
      active.on?.('chainChanged', () => { /* surface in UI */ })
    }).catch(() => {})
    // WalletConnect persists its session in storage; restore it after reload.
    // Skip during OAuth flow to avoid triggering wallet app deep-link.
    if (!isOAuthFlow) {
      restoreWalletConnect().then(addr => {
        if (!disposed && addr) {
          const wc = getWalletConnectProviderSync()
          if (wc) {
            setWalletProvider(wc)
            wc.on?.('accountsChanged', handler)
            provider = wc
          }
          onConnectRef.current(addr)
        }
      }).catch(() => {})
    }
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
      onConnected?.()
    } catch(e:any) { setError(e?.message || t('wallet.connectFailed')) }
    setLoading(false)
  }

  const connectWC = async () => {
    setError(''); setLoading(true); setShowOptions(false); setMobileSignHint(false)
    try {
      // connectWalletConnect owns the WalletConnect modal/deep-link. Do not
      // hide it behind an extra custom flow; it must foreground the wallet app
      // and return to this page after approval.
      const addr = await connectWalletConnect()
      if (addr) {
        const wcProv = getWalletConnectProviderSync()
        if (wcProv) setWalletProvider(wcProv)

        if (isMobile()) {
          // Reuse WalletConnect's peer metadata to foreground the wallet app.
          // This is only the connection flow; the OAuth SIWE request remains
          // owned by PluginPanel and is not interrupted by a second redirect.
          setMobileSignHint(true)
          redirectToWalletForSign()
          await onConnect(addr)
          setMobileSignHint(false)
      } else {
          await onConnect(addr)
          onConnected?.()
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
      <button onClick={() => setShowOptions(false)} style={{background:'none',border:'none',color:'#64748b',cursor:'pointer',fontSize:11}}>{t('wallet.back')}</button>
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
        <button onClick={() => setShowOptions(true)} style={{background:'none',border:'none',color:'#818cf8',cursor:'pointer',fontSize:11}}>{t('wallet.choose')}</button>
      )}
      {mobileSignHint && (
        <span style={{color:'#fbbf24',fontSize:11,textAlign:'right'}}>{t('wallet.signLogin')}</span>
      )}
      {error && <span className='wallet-error'>{error}</span>}
    </div>
  )
}
