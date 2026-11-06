// Wire types matching the backend API contracts exactly.

export interface HealthResponse {
  status: 'ok'
}

export interface CreateHomeRequest {
  name: string
}

export interface Home {
  id: string
  name: string
}

export type CreateHomeResponse = Home

export interface CreateMemberRequest {
  name: string
}

export interface Member {
  id: string
  homeId: string
  name: string
}

export type CreateMemberResponse = Member

export interface CreateBillRequest {
  title: string
  totalCents: number
}

export interface Share {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

export interface Bill {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

export type CreateBillResponse = Bill

export interface PayShareResponse {
  id: string
  memberId: string
  amountCents: number
  paidAt: string
}

export interface MemberBalance {
  memberId: string
  name: string
  outstandingCents: number
}

export interface BalancesResponse {
  balances: MemberBalance[]
}

export interface ApiErrorResponse {
  error: string
}

// Local storage session and recovery types.

/**
 * A bill share stored in the local session.
 *
 * Notice: `pendingIdempotencyKey` belongs to the share, NOT the bill.
 * Because a bill can contain multiple independently payable member shares,
 * each share maintains its own idempotency key across network timeouts or retries
 * until payment confirmation is received.
 */
export interface StoredShare {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
  pendingIdempotencyKey?: string | null
}

export interface StoredBill {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: StoredShare[]
  clientCreatedAt: string
}

export interface StoredHomeSession {
  version: 1
  home: Home
  members: Member[]
  bills: StoredBill[]
  cachedBalances?: MemberBalance[] | null
  pendingMemberCreation?: PendingMemberCreation | null
  updatedAt: string
}

export const ACTIVE_HOME_STORAGE_KEY = 'bill_splitter_active_home'
export const HOME_STORAGE_PREFIX = 'bill_splitter_home_'

export function getHomeStorageKey(homeId: string): string {
  return `${HOME_STORAGE_PREFIX}${homeId}`
}

export const HOME_SESSION_STORAGE_VERSION = 1

/**
 * Recovery status for home session initialization.
 *
 * - `fresh`: First-time visit, no active home ID in storage.
 * - `corrupted`: Storage contains invalid JSON or unrecognized schema version.
 * - `invalid_home`: Active home ID was rejected by the server (404 Not Found).
 * - `api_unavailable`: Backend unreachable (network offline, status 0 or 5xx).
 * - `ready`: Valid home session loaded and verified.
 */
export type SessionRecoveryStatus =
  | 'fresh'
  | 'corrupted'
  | 'invalid_home'
  | 'api_unavailable'
  | 'stale'
  | 'ready'

export interface SessionRecoveryResult {
  status: SessionRecoveryStatus
  homeId?: string | null
  session?: StoredHomeSession | null
  error?: string | null
  persistenceWarning?: string | null
}

export interface PendingMemberCreation {
  name: string
  baselineMemberIds: string[]
}
