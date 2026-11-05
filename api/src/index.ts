import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  let body: unknown

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'Request body must be an object' }, 400)
  }

  const name = (body as Record<string, unknown>).name

  if (typeof name !== 'string' || name.trim().length === 0) {
    return c.json({ error: 'Name must be a non-empty string' }, 400)
  }

  const id = crypto.randomUUID()
  const normalizedName = name.trim()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)')
    .bind(id, normalizedName)
    .run()

  return c.json(
    {
      id,
      name: normalizedName,
    },
    201,
  )
})
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  let body: unknown

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'Request body must be an object' }, 400)
  }

  const name = (body as Record<string, unknown>).name

  if (typeof name !== 'string' || name.trim().length === 0) {
    return c.json({ error: 'Name must be a non-empty string' }, 400)
  }

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const id = crypto.randomUUID()
  const normalizedName = name.trim()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, normalizedName)
    .run()

  return c.json(
    {
      id,
      homeId,
      name: normalizedName,
    },
    201,
  )
})
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  let body: unknown

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'Request body must be an object' }, 400)
  }

  const requestBody = body as Record<string, unknown>
  const title = requestBody.title
  const totalCents = requestBody.totalCents

  if (typeof title !== 'string' || title.trim().length === 0) {
    return c.json({ error: 'Title must be a non-empty string' }, 400)
  }

  if (typeof totalCents !== 'number' || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'Total cents must be a positive whole number' }, 422)
  }

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY position ASC',
  )
    .bind(homeId)
    .all<{ id: string }>()

  if (members.results.length === 0) {
    return c.json({ error: 'Cannot create a bill without members' }, 422)
  }

  const billId = crypto.randomUUID()
  const normalizedTitle = title.trim()

  const baseAmount = Math.floor(totalCents / members.results.length)
  const remainder = totalCents % members.results.length

  const shares = members.results.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: baseAmount + (index < remainder ? 1 : 0),
    paidAt: null,
  }))

  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, normalizedTitle, totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, home_id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?, ?)',
      ).bind(share.id, homeId, billId, share.memberId, share.amountCents),
    ),
  ]

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title: normalizedTitle,
      totalCents,
      shares,
    },
    201,
  )
})
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const idempotencyKey = c.req.header('Idempotency-Key')

  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const share = await c.env.DB.prepare(`
      SELECT id, member_id AS memberId, amount_cents AS amountCents,
             paid_at AS paidAt, idempotency_key AS idempotencyKey
      FROM shares
      WHERE bill_id = ? AND id = ?
    `)
    .bind(billId, shareId)
    .first<{
      id: string
      memberId: string
      amountCents: number
      paidAt: string | null
      idempotencyKey: string | null
    }>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  if (share.paidAt !== null) {
    if (share.idempotencyKey === idempotencyKey) {
      return c.json({
        id: share.id,
        memberId: share.memberId,
        amountCents: share.amountCents,
        paidAt: share.paidAt,
      })
    }

    return c.json({ error: 'Share has already been paid' }, 409)
  }

  const paidAt = new Date().toISOString()

  const result = await c.env.DB.prepare(`
      UPDATE shares
      SET paid_at = ?, idempotency_key = ?
      WHERE id = ? AND bill_id = ? AND paid_at IS NULL
    `)
    .bind(paidAt, idempotencyKey, shareId, billId)
    .run()

  if (result.meta.changes === 0) {
    // Another request may have paid this share concurrently.
    const currentShare = await c.env.DB.prepare(`
        SELECT id, member_id AS memberId, amount_cents AS amountCents,
               paid_at AS paidAt, idempotency_key AS idempotencyKey
        FROM shares
        WHERE bill_id = ? AND id = ?
      `)
      .bind(billId, shareId)
      .first<typeof share>()

    if (!currentShare) {
      return c.json({ error: 'Share not found' }, 404)
    }

    if (currentShare.idempotencyKey === idempotencyKey) {
      return c.json({
        id: currentShare.id,
        memberId: currentShare.memberId,
        amountCents: currentShare.amountCents,
        paidAt: currentShare.paidAt,
      })
    }

    return c.json({ error: 'Share has already been paid' }, 409)
  }

  return c.json({
    id: share.id,
    memberId: share.memberId,
    amountCents: share.amountCents,
    paidAt,
  })
})
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const result = await c.env.DB.prepare(`
      SELECT
        m.id AS memberId,
        m.name,
        COALESCE(SUM(s.amount_cents), 0) AS outstandingCents
      FROM members m
      LEFT JOIN shares s
        ON s.member_id = m.id
        AND s.home_id = m.home_id
        AND s.paid_at IS NULL
      WHERE m.home_id = ?
      GROUP BY m.id, m.name, m.position
      ORDER BY m.position ASC
    `)
    .bind(homeId)
    .all<{
      memberId: string
      name: string
      outstandingCents: number
    }>()

  return c.json({ balances: result.results })
})

// Consistent JSON response for unexpected errors.
app.onError((error, c) => {
  console.error('Unhandled API error:', error)
  return c.json({ error: 'Internal server error' }, 500)
})

// Consistent JSON response for unknown routes.
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404)
})

export default app
