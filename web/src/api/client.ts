import type {
  BalancesResponse,
  CreateBillRequest,
  CreateBillResponse,
  CreateHomeRequest,
  CreateHomeResponse,
  CreateMemberRequest,
  CreateMemberResponse,
  HealthResponse,
  PayShareResponse,
  Share,
} from './types'

export class ApiClientError extends Error {
  readonly status: number
  readonly data: unknown

  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.data = data
  }
}

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

function isHealthResponse(data: unknown): data is HealthResponse {
  return (
    typeof data === 'object' && data !== null && (data as Record<string, unknown>).status === 'ok'
  )
}

function isHome(data: unknown): data is CreateHomeResponse {
  if (typeof data !== 'object' || data === null) return false
  const rec = data as Record<string, unknown>
  return typeof rec.id === 'string' && typeof rec.name === 'string'
}

function isMember(data: unknown): data is CreateMemberResponse {
  if (typeof data !== 'object' || data === null) return false
  const rec = data as Record<string, unknown>
  return (
    typeof rec.id === 'string' && typeof rec.homeId === 'string' && typeof rec.name === 'string'
  )
}

function isShare(data: unknown): data is Share {
  if (typeof data !== 'object' || data === null) return false
  const rec = data as Record<string, unknown>
  return (
    typeof rec.id === 'string' &&
    typeof rec.memberId === 'string' &&
    typeof rec.amountCents === 'number' &&
    Number.isSafeInteger(rec.amountCents) &&
    rec.amountCents >= 0 &&
    (rec.paidAt === null || typeof rec.paidAt === 'string')
  )
}

function isBill(data: unknown): data is CreateBillResponse {
  if (typeof data !== 'object' || data === null) return false
  const rec = data as Record<string, unknown>
  return (
    typeof rec.id === 'string' &&
    typeof rec.homeId === 'string' &&
    typeof rec.title === 'string' &&
    typeof rec.totalCents === 'number' &&
    Number.isSafeInteger(rec.totalCents) &&
    rec.totalCents > 0 &&
    Array.isArray(rec.shares) &&
    rec.shares.every(isShare)
  )
}

function isPayShareResponse(data: unknown): data is PayShareResponse {
  if (typeof data !== 'object' || data === null) return false
  const rec = data as Record<string, unknown>
  return (
    typeof rec.id === 'string' &&
    typeof rec.memberId === 'string' &&
    typeof rec.amountCents === 'number' &&
    Number.isSafeInteger(rec.amountCents) &&
    rec.amountCents >= 0 &&
    typeof rec.paidAt === 'string'
  )
}

function isMemberBalance(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const rec = data as Record<string, unknown>
  return (
    typeof rec.memberId === 'string' &&
    typeof rec.name === 'string' &&
    typeof rec.outstandingCents === 'number' &&
    Number.isSafeInteger(rec.outstandingCents) &&
    rec.outstandingCents >= 0
  )
}

function isBalancesResponse(data: unknown): data is BalancesResponse {
  if (typeof data !== 'object' || data === null) return false
  const rec = data as Record<string, unknown>
  return Array.isArray(rec.balances) && rec.balances.every(isMemberBalance)
}

export class ApiClient {
  private readonly baseUrl: string

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl
  }

  private async requestJson(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ status: number; data: unknown }> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = { ...options.headers }

    let body: string | undefined
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }

    let response: Response
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body,
      })
    } catch (err) {
      // Network disconnect, DNS resolution failure, or server offline
      const message = err instanceof Error ? err.message : 'Network connection failed'
      throw new ApiClientError(0, message)
    }

    let data: unknown = null
    const contentType = response.headers.get('content-type')

    if (contentType?.includes('application/json')) {
      try {
        data = await response.json()
      } catch {
        data = null
      }
    } else {
      try {
        data = await response.text()
      } catch {
        data = null
      }
    }

    if (!response.ok) {
      let errorMessage = response.statusText || `Request failed with status ${response.status}`

      if (
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        typeof (data as Record<string, unknown>).error === 'string'
      ) {
        errorMessage = (data as Record<string, unknown>).error as string
      } else if (typeof data === 'string' && data.trim().length > 0) {
        errorMessage = data.trim()
      }

      throw new ApiClientError(response.status, errorMessage, data)
    }

    // Reject non-JSON, empty, or unparseable successful responses
    if (!contentType?.includes('application/json') || data === null) {
      throw new ApiClientError(response.status, 'Invalid response from server: expected JSON', data)
    }

    return { status: response.status, data }
  }

  /**
   * Health check endpoint: GET /api/health
   */
  async getHealth(): Promise<HealthResponse> {
    const { status, data } = await this.requestJson('/api/health')
    if (!isHealthResponse(data)) {
      throw new ApiClientError(status, 'Malformed health response from server', data)
    }
    return data
  }

  /**
   * Create a new home: POST /api/homes
   */
  async createHome(name: string): Promise<CreateHomeResponse> {
    const payload: CreateHomeRequest = { name }
    const { status, data } = await this.requestJson('/api/homes', {
      method: 'POST',
      body: payload,
    })
    if (!isHome(data)) {
      throw new ApiClientError(status, 'Malformed home response from server', data)
    }
    return data
  }

  /**
   * Add a member to a home: POST /api/homes/:homeId/members
   */
  async createMember(homeId: string, name: string): Promise<CreateMemberResponse> {
    const payload: CreateMemberRequest = { name }
    const { status, data } = await this.requestJson(
      `/api/homes/${encodeURIComponent(homeId)}/members`,
      {
        method: 'POST',
        body: payload,
      },
    )
    if (!isMember(data)) {
      throw new ApiClientError(status, 'Malformed member response from server', data)
    }
    return data
  }

  /**
   * Create a bill with automatic equal split: POST /api/homes/:homeId/bills
   */
  async createBill(homeId: string, title: string, totalCents: number): Promise<CreateBillResponse> {
    const payload: CreateBillRequest = { title, totalCents }
    const { status, data } = await this.requestJson(
      `/api/homes/${encodeURIComponent(homeId)}/bills`,
      {
        method: 'POST',
        body: payload,
      },
    )
    if (!isBill(data)) {
      throw new ApiClientError(status, 'Malformed bill response from server', data)
    }
    return data
  }

  /**
   * Mark a share as paid with idempotency: POST /api/bills/:billId/shares/:shareId/pay
   */
  async payShare(
    billId: string,
    shareId: string,
    idempotencyKey: string,
  ): Promise<PayShareResponse> {
    const { status, data } = await this.requestJson(
      `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    )
    if (!isPayShareResponse(data)) {
      throw new ApiClientError(status, 'Malformed payment response from server', data)
    }
    return data
  }

  /**
   * Retrieve outstanding balances for home members: GET /api/homes/:homeId/balances
   */
  async getBalances(homeId: string): Promise<BalancesResponse> {
    const { status, data } = await this.requestJson(
      `/api/homes/${encodeURIComponent(homeId)}/balances`,
    )
    if (!isBalancesResponse(data)) {
      throw new ApiClientError(status, 'Malformed balances response from server', data)
    }
    return data
  }
}

export const apiClient = new ApiClient()
