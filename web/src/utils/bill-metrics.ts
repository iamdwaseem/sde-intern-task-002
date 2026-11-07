import type { Bill } from '../api/types.ts'

export interface BillMetrics {
  totalIncurredCents: number
  settledCents: number
  pendingCents: number
}

export function calculateBillMetrics(bills: readonly Bill[]): BillMetrics {
  let totalIncurredCents = 0
  let settledCents = 0
  let pendingCents = 0

  if (!Array.isArray(bills)) {
    return { totalIncurredCents: 0, settledCents: 0, pendingCents: 0 }
  }

  for (const bill of bills) {
    if (typeof bill.totalCents === 'number' && Number.isSafeInteger(bill.totalCents)) {
      totalIncurredCents += bill.totalCents
    }
    if (Array.isArray(bill.shares)) {
      for (const share of bill.shares) {
        if (typeof share.amountCents === 'number' && Number.isSafeInteger(share.amountCents)) {
          if (share.paidAt !== null) {
            settledCents += share.amountCents
          } else {
            pendingCents += share.amountCents
          }
        }
      }
    }
  }

  return { totalIncurredCents, settledCents, pendingCents }
}
