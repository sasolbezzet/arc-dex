interface Props { circleWallet:{id:string;address:string}|null; onRefresh:()=>void }
export function OnboardingPanel({ circleWallet, onRefresh }: Props) {
  return (
    <div className='glass' style={{borderRadius:20,padding:24}}>
      <div style={{textAlign:'center',marginBottom:20}}>
        <div style={{fontSize:48,marginBottom:8}}>💰</div>
        <h2 style={{color:'#e2e8f0',fontWeight:'bold',fontSize:18,marginBottom:4}}>Fund Circle Wallet Kamu</h2>
        <p style={{color:'#64748b',fontSize:13}}>Transfer USDC ke alamat Circle Wallet untuk mulai trading</p>
      </div>
      {circleWallet&&(
        <div>
          <div style={{background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',borderRadius:12,padding:14,marginBottom:14}}>
            <div style={{color:'#64748b',fontSize:11,marginBottom:6}}>Circle Wallet Address (Arc Testnet)</div>
            <div style={{color:'#818cf8',fontFamily:'monospace',fontSize:12,wordBreak:'break-all',fontWeight:600,marginBottom:10}}>{circleWallet.address}</div>
            <button onClick={()=>navigator.clipboard.writeText(circleWallet.address)} style={{width:'100%',background:'rgba(99,102,241,0.2)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',padding:'8px',borderRadius:8,cursor:'pointer',fontSize:12}}>📋 Salin Alamat</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:14}}>
            <a href='https://faucet.circle.com/' target='_blank' rel='noreferrer' style={{display:'flex',alignItems:'center',gap:10,background:'rgba(16,185,129,0.1)',border:'1px solid rgba(16,185,129,0.3)',borderRadius:10,padding:'10px 14px',color:'#10b981',textDecoration:'none',fontSize:13}}>
              <span style={{fontSize:20}}>🚰</span><div><div style={{fontWeight:600}}>Circle Faucet</div><div style={{fontSize:11,opacity:0.8}}>Pilih ARC Testnet → USDC</div></div><span style={{marginLeft:'auto'}}>→</span>
            </a>
          </div>
          <button onClick={onRefresh} style={{width:'100%',background:'#4f46e5',color:'white',border:'none',padding:'12px',borderRadius:12,cursor:'pointer',fontWeight:600,fontSize:14}}>✓ Sudah Transfer, Cek Balance</button>
        </div>
      )}
    </div>
  )
}