import { useState } from 'react'
import { safePost } from '../api'
import { CompactTokenPicker } from './CompactPickers'
const API = ''
const TOKENS = ['USDC','EURC','USYC','cirBTC']
type Status = { type:'success'|'error'; msg:string; link?:string }
interface Props { address:string|null; circleWallet:{id:string;address:string}|null; balances:Record<string,string>; eoaBalances:Record<string,string>; onRefresh:()=>void }
export function SendPanel({ address, circleWallet, balances, eoaBalances, onRefresh }: Props) {
  const [source, setSource] = useState<'circle'|'eoa'>('circle')
  const [token, setToken] = useState('USDC')
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status|null>(null)
  const activeBal = source==='circle' ? balances : eoaBalances
  const maxBal = activeBal[token] ? parseFloat(activeBal[token]).toFixed(6) : '0'
  const handleSend = async () => {
    if (!address || !amount || !toAddress || !circleWallet) return
    if (!toAddress.startsWith('0x') || toAddress.length!==42) { setStatus({type:'error',msg:'Alamat tidak valid'}); return }
    setLoading(true); setStatus(null)
    try {
      const d = await safePost(API, '/api/send', {metamaskAddress:address,toAddress,amount,token,source})
      setStatus({ type:'success', msg:`✓ ${amount} ${token} terkirim ke ${toAddress.slice(0,8)}...`, link:d.result?.explorerUrl })
      setAmount(''); setToAddress('')
      setTimeout(onRefresh,3000)
    } catch(e:any) { setStatus({type:'error',msg:e?.message||'Send gagal'}) }
    setLoading(false)
  }
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>Kirim dari</label>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>setSource('circle')} style={{flex:1,padding:'10px 8px',borderRadius:10,border:`1px solid ${source==='circle'?'rgba(99,102,241,0.5)':'#1e1e2e'}`,background:source==='circle'?'rgba(99,102,241,0.1)':'transparent',color:source==='circle'?'#818cf8':'#64748b',cursor:'pointer',fontSize:12,fontWeight:600,textAlign:'left'}}>
            <div>🔵 Circle Wallet</div>
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
          <label style={{color:'#64748b',fontSize:13}}>Token & Jumlah</label>
          <button onClick={()=>setAmount(maxBal)} style={{color:source==='circle'?'#818cf8':'#f59e0b',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0}}>Max: {parseFloat(maxBal).toFixed(4)}</button>
        </div>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder='0.00' value={amount} onChange={e=>setAmount(e.target.value)} />
          <CompactTokenPicker value={token} options={TOKENS} onChange={setToken} />
        </div>
      </div>
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>Alamat Tujuan</label>
        <input className='input' type='text' placeholder='0x...' value={toAddress} onChange={e=>setToAddress(e.target.value)} style={{fontFamily:'monospace',fontSize:12}} />
        <div style={{display:'flex',gap:6,marginTop:6}}>
          {circleWallet&&<button onClick={()=>setToAddress(circleWallet.address)} style={{fontSize:10,background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',padding:'3px 8px',borderRadius:6,cursor:'pointer'}}>→ Circle Wallet</button>}
          {address&&<button onClick={()=>setToAddress(address)} style={{fontSize:10,background:'rgba(245,158,11,0.1)',color:'#f59e0b',border:'1px solid rgba(245,158,11,0.3)',padding:'3px 8px',borderRadius:6,cursor:'pointer'}}>→ MetaMask</button>}
        </div>
      </div>
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12,display:'flex',flexDirection:'column',gap:3}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Network</span><span>Arc Testnet</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Dari</span><span style={{color:source==='circle'?'#818cf8':'#f59e0b',fontFamily:'monospace',fontSize:11}}>{source==='circle'?circleWallet?.address.slice(0,8):address?.slice(0,8)}...{source==='circle'?circleWallet?.address.slice(-6):address?.slice(-4)}</span></div>
      </div>
      {status&&<div style={{padding:10,borderRadius:10,fontSize:13,background:status.type==='success'?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.1)',color:status.type==='success'?'#10b981':'#f87171',border:status.type==='success'?'1px solid rgba(16,185,129,0.3)':'1px solid rgba(239,68,68,0.3)'}}>{status.msg}{status.link&&<div style={{marginTop:4}}><a href={status.link} target='_blank' rel='noreferrer' style={{color:'#818cf8',fontSize:11}}>Explorer →</a></div>}</div>}
      <button onClick={handleSend} disabled={!amount||!toAddress||loading||!circleWallet} className='btn btn-primary'>{loading?'⏳ Mengirim...':amount?`Kirim ${amount} ${token} dari ${source==='circle'?'Circle':'MetaMask'}`:'Kirim Token'}</button>
    </div>
  )
}
