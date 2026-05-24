const fs = require('fs');
let bridge = fs.readFileSync('src/components/BridgePanel.tsx', 'utf-8');

// Ganti bagian mint EVM - dari backend ke user sign
bridge = bridge.replace(
  `    } else {
      // Mint di EVM via backend
      const mintResp = await fetch(API+'/api/mint-cctp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({burnTxHash:burnTx,fromChain,toChain}) })
      const mintData = await mintResp.json()
      if (!mintResp.ok || !mintData.success) throw new Error(mintData.error||'Mint gagal')
      localSteps[localSteps.length-1].state='success'
      localSteps.push({ name:'mint', state:'success', txHash:mintData.txHash, explorerUrl:mintData.explorerUrl })
      setStatus({ type:'success', msg:\`✓ Bridge berhasil! \${amount} USDC → \${toChain}\`, steps:[...localSteps] })
    }`,
  `    } else {
      // Ambil attestation dari backend
      const attResp = await fetch(API+'/api/get-attestation', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({txHash:burnTx,fromChain}) })
      const attData = await attResp.json()
      if (!attResp.ok || !attData.success) throw new Error(attData.error||'Attestation gagal')
      localSteps[localSteps.length-1].state='success'

      // Switch ke destination chain
      const dstChainInfo = EVM_CHAINS.find(c=>c.id===toChain)
      if (dstChainInfo) {
        setStep('Switch ke destination chain...')
        try {
          await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{chainId:dstChainInfo.chainId}] })
          await new Promise(r=>setTimeout(r,2000))
        } catch(e:any) {
          if ((e.code===4902||e.code===-32603) && dstChainInfo.addParams) {
            await window.ethereum.request({ method:'wallet_addEthereumChain', params:[dstChainInfo.addParams] })
            await new Promise(r=>setTimeout(r,3000))
          }
        }
      }

      // User sign receiveMessage di destination chain (MetaMask popup #3)
      setStep('MetaMask: Konfirmasi mint di destination (3/3)...')
      setStatus({ type:'info', msg:'⏳ MetaMask popup 3/3: Konfirmasi mint USDC di '+toChain+'...', steps:[...localSteps] })

      const DST_TRANSMITTER: Record<string,string> = {
        Arc_Testnet: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
        Ethereum_Sepolia: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
        Base_Sepolia: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
        Arbitrum_Sepolia: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
      }

      // Encode receiveMessage calldata
      const msgHex = attData.message.startsWith('0x') ? attData.message.slice(2) : attData.message
      const attHex = attData.attestation.startsWith('0x') ? attData.attestation.slice(2) : attData.attestation
      const encodeBytes = (hex: string) => {
        const len = (hex.length/2).toString(16).padStart(64,'0')
        const padded = hex.padEnd(Math.ceil(hex.length/64)*64,'0')
        return len + padded
      }
      // receiveMessage(bytes message, bytes attestation) selector = 0x57ecfd28
      const msgOffset = '0000000000000000000000000000000000000000000000000000000000000040'
      const attOffset = (64 + 32 + Math.ceil(msgHex.length/2/32)*32 + 32).toString(16).padStart(64,'0')
      // Simpler: pakai selector + ABI encode manual
      const selector = '0x57ecfd28'
      const calldata = selector + msgOffset + attOffset + encodeBytes(msgHex) + encodeBytes(attHex)

      const mintTx = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: DST_TRANSMITTER[toChain], data: calldata, gas: '0x493e0' }]
      })
      localSteps.push({ name:'mint', state:'pending', txHash:mintTx })
      setStatus({ type:'info', msg:'⏳ Menunggu mint dikonfirmasi...', steps:[...localSteps] })
      await waitEvmTx(mintTx)

      const DST_EXPLORER: Record<string,string> = {
        Arc_Testnet: 'https://testnet.arcscan.app/tx/',
        Ethereum_Sepolia: 'https://sepolia.etherscan.io/tx/',
        Base_Sepolia: 'https://sepolia.basescan.org/tx/',
        Arbitrum_Sepolia: 'https://sepolia.arbiscan.io/tx/',
      }
      localSteps[localSteps.length-1].state='success'
      localSteps[localSteps.length-1].explorerUrl=(DST_EXPLORER[toChain]||'')+mintTx
      setStatus({ type:'success', msg:\`✓ Bridge berhasil! \${amount} USDC → \${toChain}\`, steps:[...localSteps] })
    }`
);

// Update info panel - MetaMask popup jadi 3x untuk EVM-EVM
bridge = bridge.replace(
  `{!isFromSolana && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>MetaMask popup</span><span>2x (approve + burn)</span></div>}`,
  `{!isFromSolana && !isToSolana && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>MetaMask popup</span><span style={{color:'#10b981'}}>3x (approve + burn + mint)</span></div>}
        {!isFromSolana && isToSolana && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>MetaMask popup</span><span>2x + Solflare 1x</span></div>}`
);

// Fix ABI encode offset yang benar
// Hitung offset yang tepat untuk ABI encoding
bridge = bridge.replace(
  `      const msgOffset = '0000000000000000000000000000000000000000000000000000000000000040'
      const attOffset = (64 + 32 + Math.ceil(msgHex.length/2/32)*32 + 32).toString(16).padStart(64,'0')
      // Simpler: pakai selector + ABI encode manual
      const selector = '0x57ecfd28'
      const calldata = selector + msgOffset + attOffset + encodeBytes(msgHex) + encodeBytes(attHex)`,
  `      // ABI encode: receiveMessage(bytes,bytes)
      // offset1 = 0x40 (64 bytes = setelah 2 offset slots)
      const msgByteLen = msgHex.length/2
      const msgPaddedLen = Math.ceil(msgByteLen/32)*32
      // offset2 = 64 + 32 (len) + msgPaddedLen
      const attOffsetNum = 64 + 32 + msgPaddedLen
      const attOffsetHex = attOffsetNum.toString(16).padStart(64,'0')
      const selector = '0x57ecfd28'
      const calldata = selector + '0000000000000000000000000000000000000000000000000000000000000040' + attOffsetHex + encodeBytes(msgHex) + encodeBytes(attHex)`
);

fs.writeFileSync('src/components/BridgePanel.tsx', bridge);
console.log('User-sign mint implemented - MetaMask popup 3x for EVM');
