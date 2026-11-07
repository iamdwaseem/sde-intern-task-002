import { describe, expect, it } from 'vitest'
import { type Bill, call, createBill, createHome, type Share } from './helpers'

describe('GET /api/homes/:homeId', () => {
  it('returns 200 with { id, name } for an existing home', async () => {
    const created = await call<{ id: string; name: string }>('POST', '/api/homes', {
      body: { name: 'Riverside Flat' },
    })
    expect(created.status).toBe(201)

    const result = await call<{ id: string; name: string }>('GET', `/api/homes/${created.body.id}`)

    expect(result.status).toBe(200)
    expect(result.body.id).toBe(created.body.id)
    expect(result.body.name).toBe('Riverside Flat')
  })

  it('returns 404 for an unknown home', async () => {
    const result = await call('GET', '/api/homes/does-not-exist')

    expect(result.status).toBe(404)
  })
})

describe('GET /api/homes/:homeId/bills', () => {
  it('returns 200 with an empty bills array when the home has no bills', async () => {
    const { homeId } = await createHome([])

    const result = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(result.status).toBe(200)
    expect(result.body.bills).toEqual([])
  })

  it('returns newest bill first (descending insertion order)', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])

    const first = await createBill(homeId, 1000)
    const second = await createBill(homeId, 2000)

    const result = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(result.status).toBe(200)
    expect(result.body.bills.length).toBe(2)
    // Newest bill (second) must appear first
    expect(result.body.bills[0]?.id).toBe(second.body.id)
    expect(result.body.bills[1]?.id).toBe(first.body.id)
  })

  it('returns shares in member position order (ascending)', async () => {
    const { homeId, members } = await createHome(['Alice', 'Bob', 'Carol'])

    await createBill(homeId, 300)

    const result = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(result.status).toBe(200)
    const bill = result.body.bills[0]
    expect(bill).toBeDefined()
    if (!bill) return

    expect(bill.shares.length).toBe(3)
    expect(bill.shares[0]?.memberId).toBe(members[0]?.id)
    expect(bill.shares[1]?.memberId).toBe(members[1]?.id)
    expect(bill.shares[2]?.memberId).toBe(members[2]?.id)
  })

  it('reflects paid status after paying a share', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const firstShare = bill.body.shares[0]
    if (!firstShare) throw new Error('bill has no shares')

    // Pay the first share
    const paid = await call<Share>(
      'POST',
      `/api/bills/${bill.body.id}/shares/${firstShare.id}/pay`,
      {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      },
    )
    expect(paid.status).toBe(200)

    const result = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(result.status).toBe(200)
    const fetchedBill = result.body.bills[0]
    expect(fetchedBill).toBeDefined()
    if (!fetchedBill) return

    const paidShare = fetchedBill.shares.find((s) => s.id === firstShare.id)
    const unpaidShare = fetchedBill.shares.find((s) => s.id !== firstShare.id)

    expect(paidShare?.paidAt).toEqual(expect.any(String))
    expect(unpaidShare?.paidAt).toBeNull()
  })

  it('returns 404 for an unknown home', async () => {
    const result = await call('GET', '/api/homes/does-not-exist/bills')

    expect(result.status).toBe(404)
  })
})
