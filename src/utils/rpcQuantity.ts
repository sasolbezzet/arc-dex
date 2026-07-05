export function isEmptyRpcData(value: unknown) {
  return value == null || String(value).trim() === '' || /^0x$/i.test(String(value).trim())
}

export function isEmptyContractCode(value: unknown) {
  return value == null || /^(?:0x)?0*$/i.test(String(value).trim())
}

export function rpcUint(value: unknown, label = 'RPC quantity', allowEmpty = false) {
  const text = String(value ?? '').trim()
  if (isEmptyRpcData(text)) {
    if (allowEmpty) return 0n
    throw new Error(`${label} returned an empty RPC quantity.`)
  }
  if (!/^(?:0x[0-9a-f]+|\d+)$/i.test(text)) throw new Error(`${label} returned an invalid RPC quantity.`)
  return BigInt(text)
}

export function requiredPositiveUint(value: unknown, label: string) {
  const amount = rpcUint(value, label)
  if (amount <= 0n) throw new Error(`${label} must be greater than zero.`)
  return amount
}
