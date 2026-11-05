import { describe, expect, it } from 'vitest'
import { call } from './helpers'

const invalidBodies: Array<{ label: string; body: unknown }> = [
  { label: 'missing name', body: {} },
  { label: 'null name', body: { name: null } },
  { label: 'numeric name', body: { name: 123 } },
  { label: 'empty name', body: { name: '' } },
  { label: 'whitespace-only name', body: { name: '   ' } },
  { label: 'null request body', body: null },
  { label: 'array request body', body: [] },
]

describe('home request validation', () => {
  for (const testCase of invalidBodies) {
    it(`rejects ${testCase.label}`, async () => {
      const response = await call<{ error: string }>('POST', '/api/homes', { body: testCase.body })

      expect(response.status).toBe(400)
      expect(response.body.error).toEqual(expect.any(String))
    })
  }
})
