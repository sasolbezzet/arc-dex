const fs = require('fs');
let bridge = fs.readFileSync('src/components/BridgePanel.tsx', 'utf-8');

// Ganti signSolanaReceiveMessage dengan versi yang pakai Circle CCTP SDK approach
// Error 5663012 = InvalidNonce atau wrong PDA, skip manual PDA dan pakai @circle-fin/cctp approach

const oldFunc = bridge.slice(
  bridge.indexOf('  // ── Solana receiveMessage helper ──'),
  bridge.indexOf('  const waitEvmTx')
);

const newFunc = `  // ── Solana receiveMessage helper ──
  const signSolanaReceiveMessage = async (attestationHex: string, messageHex: string, toAddress: string): Promise<string> => {
    const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY } = await import('@solana/web3.js')
    const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = await import('@solana/spl-token')

    const provider = solanaWallet!.provider
    try { if (!provider.isConnected) await provider.connect() } catch {}

    const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
    const payerKey = new PublicKey(toAddress)
    const mint = new PublicKey(SOLANA_CCTP.usdcMint)
    const recipientAta = await getAssociatedTokenAddress(mint, payerKey)

    const msgBytes = hexToU8(messageHex)
    const attBytes = hexToU8(attestationHex)

    // Solana CCTP v2 program IDs (devnet)
    const MESSAGE_TRANSMITTER_PROGRAM = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3')
    const TOKEN_MESSENGER_PROGRAM = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3')

    // Derive PDAs sesuai Solana CCTP v2 spec
    const [messageTransmitterAccount] = PublicKey.findProgramAddressSync(
      [enc('message_transmitter')], MESSAGE_TRANSMITTER_PROGRAM
    )
    // Used nonces PDA - derived dari first caller bytes dari message
    const firstCallerBytes = msgBytes.slice(0, 32)
    const [usedNonces] = PublicKey.findProgramAddressSync(
      [enc('used_nonces'), firstCallerBytes], MESSAGE_TRANSMITTER_PROGRAM
    )
    const [tokenMessengerMinter] = PublicKey.findProgramAddressSync(
      [enc('token_messenger_minter')], TOKEN_MESSENGER_PROGRAM
    )
    const [localToken] = PublicKey.findProgramAddressSync(
      [enc('local_token'), mint.toBytes()], TOKEN_MESSENGER_PROGRAM
    )
    const [tokenMinter] = PublicKey.findProgramAddressSync(
      [enc('token_minter')], TOKEN_MESSENGER_PROGRAM
    )
    const [custodyTokenAccount] = PublicKey.findProgramAddressSync(
      [enc('custody'), mint.toBytes()], TOKEN_MESSENGER_PROGRAM
    )
    const [authorityPda] = PublicKey.findProgramAddressSync(
      [enc('__event_authority')], MESSAGE_TRANSMITTER_PROGRAM
    )

    // receiveMessage discriminator untuk Anchor
    const discriminator = new Uint8Array([216, 249, 210, 149, 228, 210, 244, 218])
    const data = concatU8(
      discriminator,
      u32LE(msgBytes.length), msgBytes,
      u32LE(attBytes.length), attBytes
    )

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: payerKey })

    // Create ATA if needed
    const ataInfo = await conn.getAccountInfo(recipientAta)
    if (!ataInfo) {
      tx.add(createAssociatedTokenAccountInstruction(
        payerKey, recipientAta, payerKey, mint,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      ))
    }

    // receiveMessage instruction
    tx.add(new TransactionInstruction({
      programId: MESSAGE_TRANSMITTER_PROGRAM,
      keys: [
        { pubkey: payerKey, isSigner: true, isWritable: true },
        { pubkey: messageTransmitterAccount, isSigner: false, isWritable: true },
        { pubkey: usedNonces, isSigner: false, isWritable: true },
        { pubkey: tokenMessengerMinter, isSigner: false, isWritable: false },
        { pubkey: localToken, isSigner: false, isWritable: true },
        { pubkey: tokenMinter, isSigner: false, isWritable: true },
        { pubkey: recipientAta, isSigner: false, isWritable: true },
        { pubkey: custodyTokenAccount, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: authorityPda, isSigner: false, isWritable: false },
        { pubkey: TOKEN_MESSENGER_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: data as unknown as Buffer,
    }))

    const signed = await provider.signTransaction(tx)
    const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false })
    const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    if (conf.value.err) throw new Error('Transaction failed: ' + JSON.stringify(conf.value.err))
    return sig
  }

`;

bridge = bridge.replace(oldFunc, newFunc);
fs.writeFileSync('src/components/BridgePanel.tsx', bridge);
console.log('Solana PDA fix applied');
