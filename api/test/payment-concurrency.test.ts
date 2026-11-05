import { describe, expect, it } from 'vitest'
import { call, createBill, createHome, type Share } from './helpers'

function pay(billId: string, shareId: string, key: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': key },
  })
}

describe('concurrent share payments', () => {
  it('allows only one different idempotency key to pay a share', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]

    if (!share) throw new Error('Bill has no shares')

    const [first, second] = await Promise.all([
      pay(bill.body.id, share.id, crypto.randomUUID()),
      pay(bill.body.id, share.id, crypto.randomUUID()),
    ])

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409])
  })

  it('returns the same result for concurrent requests with the same key', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]

    if (!share) throw new Error('Bill has no shares')

    const key = crypto.randomUUID()

    const [first, second] = await Promise.all([
      pay(bill.body.id, share.id, key),
      pay(bill.body.id, share.id, key),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.paidAt).toBe(second.body.paidAt)
  })
})
