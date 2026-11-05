import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiClient, ApiClientError } from './client.ts'

describe('ApiClient', () => {
  it('instantiates ApiClientError with status, message and data', () => {
    const error = new ApiClientError(404, 'Home not found', {
      error: 'Home not found',
    })
    assert.equal(error.status, 404)
    assert.equal(error.message, 'Home not found')
    assert.deepEqual(error.data, { error: 'Home not found' })
    assert.equal(error.name, 'ApiClientError')
    assert.ok(error instanceof Error)
  })

  it('rejects successful responses with non-JSON content-type', async () => {
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response('<html>Error</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })

      const client = new ApiClient()
      await assert.rejects(
        async () => client.getHealth(),
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError)
          assert.equal(err.status, 200)
          assert.match(err.message, /expected JSON/i)
          return true
        },
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects successful responses with malformed payload', async () => {
    const originalFetch = globalThis.fetch
    try {
      // Returns 200 JSON, but missing required properties for home
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ unexpected: 'field' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })

      const client = new ApiClient()
      await assert.rejects(
        async () => client.createHome('My Home'),
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError)
          assert.equal(err.status, 200)
          assert.match(err.message, /malformed home response/i)
          return true
        },
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects responses with invalid monetary values', async () => {
    const originalFetch = globalThis.fetch
    try {
      const client = new ApiClient()

      // 1. Bill totalCents <= 0
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            id: 'b1',
            homeId: 'h1',
            title: 'Electric',
            totalCents: 0,
            shares: [],
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      await assert.rejects(
        async () => client.createBill('h1', 'Electric', 100),
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError)
          assert.match(err.message, /malformed bill response/i)
          return true
        },
      )

      // 2. Bill share amountCents is negative or fractional
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            id: 'b1',
            homeId: 'h1',
            title: 'Electric',
            totalCents: 1000,
            shares: [{ id: 's1', memberId: 'm1', amountCents: -50, paidAt: null }],
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      await assert.rejects(
        async () => client.createBill('h1', 'Electric', 1000),
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError)
          assert.match(err.message, /malformed bill response/i)
          return true
        },
      )

      // 3. Balance outstandingCents is negative or non-integer
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            balances: [{ memberId: 'm1', name: 'Alice', outstandingCents: 12.34 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      await assert.rejects(
        async () => client.getBalances('h1'),
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError)
          assert.match(err.message, /malformed balances response/i)
          return true
        },
      )

      // 4. Payment amountCents is negative
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            id: 's1',
            memberId: 'm1',
            amountCents: -100,
            paidAt: '2026-11-06T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      await assert.rejects(
        async () => client.payShare('b1', 's1', 'key'),
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError)
          assert.match(err.message, /malformed payment response/i)
          return true
        },
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('handles valid responses successfully', async () => {
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (input, init) => {
        const url = String(input)
        if (url === '/api/homes') {
          return new Response(JSON.stringify({ id: 'h1', name: 'Apartment' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url === '/api/bills/b1/shares/s1/pay') {
          assert.equal(
            init?.headers && (init.headers as Record<string, string>)['Idempotency-Key'],
            'idem-123',
          )
          return new Response(
            JSON.stringify({
              id: 's1',
              memberId: 'm1',
              amountCents: 1000,
              paidAt: '2026-11-06T00:00:00.000Z',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return new Response('Not found', { status: 404 })
      }

      const client = new ApiClient()
      const home = await client.createHome('Apartment')
      assert.deepEqual(home, { id: 'h1', name: 'Apartment' })

      const payment = await client.payShare('b1', 's1', 'idem-123')
      assert.deepEqual(payment, {
        id: 's1',
        memberId: 'm1',
        amountCents: 1000,
        paidAt: '2026-11-06T00:00:00.000Z',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('preserves HTTP status 0 on network failures', async () => {
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () => {
        throw new TypeError('Failed to fetch')
      }

      const client = new ApiClient()
      await assert.rejects(
        async () => client.getHealth(),
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError)
          assert.equal(err.status, 0)
          assert.equal(err.message, 'Failed to fetch')
          return true
        },
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
