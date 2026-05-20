import { useState, useEffect } from 'react'
declare global { interface Window { ethereum?: any } }
interface Props { address: string|null; onConnect:(a:string)=>void; onDisconnect:()=>void }
export function WalletButton({ address, onConnect, onDisconnect }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' }).then((a: string[]) => { if (a[0]) onConnect(a[0]) })
      window.ethereum.on('accountsChanged', (a: string[]) => { if (a[0]) onConnect(a[0]); else onDisconnect() })
    }
  }, [])
  const connect = async () => {
    setError(''); setLoading(true)
    if (!window.ethereum) { setError('Install MetaMask terlebih dahulu'); setLoading(false); return }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      onConnect(accounts[0])
    } catch(e:any) { setError(e?.message || 'Gagal connect') }
    setLoading(false)
  }
  if (address) return (
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <div className='glass' style={{padding:'6px 12px',borderRadius:10,fontSize:12}}>
        <span style={{color:'#64748b'}}>Connected: </span>
        <span style={{color:'#818cf8',fontFamily:'monospace'}}>{address.slice(0,6)}...{address.slice(-4)}</span>
      </div>
      <button onClick={onDisconnect} style={{background:'rgba(239,68,68,0.2)',color:'#f87171',border:'1px solid rgba(239,68,68,0.3)',padding:'6px 12px',borderRadius:10,cursor:'pointer',fontSize:12}}>Disconnect</button>
    </div>
  )
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
      <button onClick={connect} disabled={loading} className='btn btn-primary' style={{width:'auto',padding:'8px 20px',fontSize:13}}>
        {loading ? 'Connecting...' : 'Connect Wallet'}
      </button>
      {error && <span style={{fontSize:11,color:'#f87171',maxWidth:180,textAlign:'right'}}>{error}</span>}
    </div>
  )
}