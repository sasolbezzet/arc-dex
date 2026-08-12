export function isSuccessfulUserOpReceipt(receipt: any): boolean {
  const status = receipt?.receipt?.status
  return receipt?.success === true && (status === '0x1' || status === 'success' || status === 1 || status === true)
}
