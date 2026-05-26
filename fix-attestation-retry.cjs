const fs = require('fs');
let bridge = fs.readFileSync('src/components/BridgePanel.tsx', 'utf-8');

// Ganti fetch get-attestation dengan retry logic
bridge = bridge.replace(
  `      const attResp = await fetch(API+'/api/get-attestation', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({txHash:burnTx,fromChain}) })
      const attData = await attResp.json()
      if (!attResp.ok || !attData.success) throw new Error(attData.error||'Attestation gagal')`,
  `      // Retry attestation sampai 3x kalau timeout
      let attData: any = null
      for (let retry = 0; retry < 3; retry++) {
        setStep(\`Menunggu attestation... (percobaan \${retry+1}/3, ~2 menit)\`)
        const attResp = await fetch(API+'/api/get-attestation', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({txHash:burnTx,fromChain})
        })
        const data = await attResp.json()
        if (attResp.ok && data.success) { attData = data; break }
        if (retry < 2) {
          setStatus({ type:'info', msg:\`⏳ Attestation belum siap, retry dalam 15 detik...\`, steps:[...localSteps] })
          await new Promise(r=>setTimeout(r,15000))
        } else {
          throw new Error(data.error || 'Attestation timeout setelah 3x percobaan')
        }
      }
      if (!attData) throw new Error('Attestation gagal')`
);

fs.writeFileSync('src/components/BridgePanel.tsx', bridge);
console.log('Attestation retry added');
