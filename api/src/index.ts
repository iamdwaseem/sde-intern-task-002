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
