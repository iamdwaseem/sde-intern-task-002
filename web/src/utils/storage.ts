import type { ApiClient } from '../api/client.ts'
import { ApiClientError } from '../api/client.ts'
import {
  ACTIVE_HOME_STORAGE_KEY,
  type BalancesResponse,
  type CreateBillResponse,
  getHomeStorageKey,
  HOME_SESSION_STORAGE_VERSION,
  type Home,
  type Member,
  type MemberBalance,
  type PendingMemberCreation,
  type SessionRecoveryResult,
  type Share,
  type StoredBill,
  type StoredHomeSession,
  type StoredShare,
} from '../api/types.ts'

export function isHome(raw: unknown): raw is Home {
  if (typeof raw !== 'object' || raw === null) return false
  const rec = raw as Record<string, unknown>
  return typeof rec.id === 'string' && typeof rec.name === 'string'
}

export function isMember(raw: unknown): raw is Member {
  if (typeof raw !== 'object' || raw === null) return false
  const rec = raw as Record<string, unknown>
  return (
    typeof rec.id === 'string' && typeof rec.homeId === 'string' && typeof rec.name === 'string'
  )
}

export function isStoredShare(raw: unknown): raw is StoredShare {
  if (typeof raw !== 'object' || raw === null) return false
  const rec = raw as Record<string, unknown>
  const hasValidIdempotency =
    rec.pendingIdempotencyKey === undefined ||
    rec.pendingIdempotencyKey === null ||
    typeof rec.pendingIdempotencyKey === 'string'

  return (
    typeof rec.id === 'string' &&
    typeof rec.memberId === 'string' &&
    typeof rec.amountCents === 'number' &&
    Number.isSafeInteger(rec.amountCents) &&
    rec.amountCents >= 0 &&
    (rec.paidAt === null || typeof rec.paidAt === 'string') &&
    hasValidIdempotency
  )
}

export function isStoredBill(raw: unknown): raw is StoredBill {
  if (typeof raw !== 'object' || raw === null) return false
  const rec = raw as Record<string, unknown>
  return (
    typeof rec.id === 'string' &&
    typeof rec.homeId === 'string' &&
    typeof rec.title === 'string' &&
    typeof rec.totalCents === 'number' &&
    Number.isSafeInteger(rec.totalCents) &&
    rec.totalCents > 0 &&
    typeof rec.clientCreatedAt === 'string' &&
    Array.isArray(rec.shares) &&
    rec.shares.every(isStoredShare)
  )
}

export function isMemberBalance(raw: unknown): raw is MemberBalance {
  if (typeof raw !== 'object' || raw === null) return false
  const rec = raw as Record<string, unknown>
  return (
    typeof rec.memberId === 'string' &&
    typeof rec.name === 'string' &&
    typeof rec.outstandingCents === 'number' &&
    Number.isSafeInteger(rec.outstandingCents) &&
    rec.outstandingCents >= 0
  )
}

export function isPendingMemberCreation(raw: unknown): raw is PendingMemberCreation {
  if (typeof raw !== 'object' || raw === null) return false
  const rec = raw as Record<string, unknown>
  return (
    typeof rec.name === 'string' &&
    Array.isArray(rec.baselineMemberIds) &&
    rec.baselineMemberIds.every((id) => typeof id === 'string')
  )
}

export function validateHomeSession(raw: unknown): StoredHomeSession | null {
  if (typeof raw !== 'object' || raw === null) return null
  const rec = raw as Record<string, unknown>

  if (rec.version !== HOME_SESSION_STORAGE_VERSION) {
    return null
  }

  if (!isHome(rec.home)) {
    return null
  }

  if (!Array.isArray(rec.members) || !rec.members.every(isMember)) {
    return null
  }

  if (!Array.isArray(rec.bills) || !rec.bills.every(isStoredBill)) {
    return null
  }

  if (typeof rec.updatedAt !== 'string') {
    return null
  }

  if (rec.cachedBalances !== undefined && rec.cachedBalances !== null) {
    if (!Array.isArray(rec.cachedBalances) || !rec.cachedBalances.every(isMemberBalance)) {
      return null
    }
  }

  if (
    rec.pendingMemberCreation !== undefined &&
    rec.pendingMemberCreation !== null &&
    !isPendingMemberCreation(rec.pendingMemberCreation)
  ) {
    return null
  }

  return {
    version: 1,
    home: rec.home,
    members: rec.members,
    bills: rec.bills,
    cachedBalances: (rec.cachedBalances as MemberBalance[] | null) ?? null,
    pendingMemberCreation: (rec.pendingMemberCreation as PendingMemberCreation | null) ?? null,
    updatedAt: rec.updatedAt,
  }
}

// Low-level localStorage primitives (allows mock storage injection in tests)

/**
 * Safely resolves the storage instance without throwing if window.localStorage
 * getter throws a SecurityError (e.g. cookies disabled, restricted iframe).
 */
export function getSafeStorage(injected?: Storage | null): Storage | null {
  if (injected !== undefined) {
    return injected
  }
  try {
    if (typeof window !== 'undefined') {
      return window.localStorage
    }
  } catch {
    return null
  }
  return null
}

// Low-level localStorage primitives (allows mock storage injection in tests)

export function loadActiveHomeId(storage?: Storage | null): string | null {
  try {
    const s = getSafeStorage(storage)
    if (!s) return null
    const value = s.getItem(ACTIVE_HOME_STORAGE_KEY)
    return value && value.trim().length > 0 ? value.trim() : null
  } catch {
    return null
  }
}

export function saveActiveHomeId(homeId: string, storage?: Storage | null): boolean {
  try {
    const s = getSafeStorage(storage)
    if (!s) return false
    s.setItem(ACTIVE_HOME_STORAGE_KEY, homeId)
    return true
  } catch {
    return false
  }
}

export function clearActiveHomeId(storage?: Storage | null): void {
  try {
    const s = getSafeStorage(storage)
    if (!s) return
    s.removeItem(ACTIVE_HOME_STORAGE_KEY)
  } catch {
    // Ignore
  }
}

export function loadHomeSession(
  homeId: string,
  storage?: Storage | null,
): StoredHomeSession | null {
  try {
    const s = getSafeStorage(storage)
    if (!s) return null
    const raw = s.getItem(getHomeStorageKey(homeId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return validateHomeSession(parsed)
  } catch {
    return null
  }
}

export function saveHomeSession(session: StoredHomeSession, storage?: Storage | null): boolean {
  try {
    const s = getSafeStorage(storage)
    if (!s) return false
    s.setItem(getHomeStorageKey(session.home.id), JSON.stringify(session))
    return true
  } catch {
    return false
  }
}

export function clearHomeSession(homeId: string, storage?: Storage | null): void {
  try {
    const s = getSafeStorage(storage)
    if (!s) return
    s.removeItem(getHomeStorageKey(homeId))
  } catch {
    // Ignore
  }
}

/**
 * Initializes a new clean versioned session for a newly created home.
 */
export function initializeHomeSession(home: Home): StoredHomeSession {
  return {
    version: 1,
    home,
    members: [],
    bills: [],
    cachedBalances: [],
    pendingMemberCreation: null,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Persists a newly created household session in storage before writing the active home ID.
 * Returns the initialized session and individual persistence booleans.
 */
export function persistNewHouseholdSession(
  home: Home,
  storage?: Storage | null,
): {
  session: StoredHomeSession
  sessionSaved: boolean
  activeIdSaved: boolean
} {
  const newSession = initializeHomeSession(home)
  // Requirement: Persist the new session before writing the active household ID
  const sessionSaved = saveHomeSession(newSession, storage)
  const activeIdSaved = sessionSaved ? saveActiveHomeId(home.id, storage) : false
  return {
    session: newSession,
    sessionSaved,
    activeIdSaved,
  }
}

/**
 * Recovers and validates the active household session on initial load.
 *
 * Sequence:
 * 1. Read ACTIVE_HOME_STORAGE_KEY. If absent -> 'fresh'.
 * 2. Retrieve session from storage. If missing, corrupt JSON, or wrong version -> 'corrupted'.
 * 3. Call apiClient.getBalances(homeId) to verify home exists and fetch authoritative balances.
 * 4. If 200 OK -> update members, cachedBalances, save session -> 'ready'.
 * 5. If 404 Not Found -> home was deleted/reset on server. Clear corrupt local entry -> 'invalid_home'.
 * 6. If network failure (status 0 or 5xx) -> preserve session, do NOT clear -> 'api_unavailable'.
 * 7. If other HTTP error or malformed response -> preserve session -> 'stale'.
 */
export async function restoreHouseholdSession(
  apiClient: ApiClient,
  storage?: Storage | null,
): Promise<SessionRecoveryResult> {
  let targetStorage: Storage | null = null
  try {
    targetStorage = getSafeStorage(storage)
  } catch (err) {
    return {
      status: 'corrupted',
      error: `Storage access unavailable: ${err instanceof Error ? err.message : 'SecurityError'}`,
    }
  }

  if (!targetStorage) {
    return {
      status: 'corrupted',
      error:
        'Storage access unavailable: localStorage is inaccessible or restricted (SecurityError)',
    }
  }

  let activeHomeId: string | null = null
  try {
    const value = targetStorage.getItem(ACTIVE_HOME_STORAGE_KEY)
    activeHomeId = value && value.trim().length > 0 ? value.trim() : null
  } catch (err) {
    return {
      status: 'corrupted',
      error: `Storage access unavailable: ${err instanceof Error ? err.message : 'SecurityError'}`,
    }
  }

  if (!activeHomeId) {
    return { status: 'fresh' }
  }

  let rawJson: string | null = null
  try {
    rawJson = targetStorage.getItem(getHomeStorageKey(activeHomeId))
  } catch (err) {
    return {
      status: 'corrupted',
      homeId: activeHomeId,
      error: `Storage access unavailable: ${err instanceof Error ? err.message : 'SecurityError'}`,
    }
  }

  if (!rawJson) {
    clearActiveHomeId(targetStorage)
    clearHomeSession(activeHomeId, targetStorage)
    return {
      status: 'corrupted',
      homeId: activeHomeId,
      error: 'Stored session data missing for active household',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    clearActiveHomeId(targetStorage)
    clearHomeSession(activeHomeId, targetStorage)
    return {
      status: 'corrupted',
      homeId: activeHomeId,
      error: 'Session data is not valid JSON',
    }
  }

  const session = validateHomeSession(parsed)
  if (!session) {
    clearActiveHomeId(targetStorage)
    clearHomeSession(activeHomeId, targetStorage)
    return {
      status: 'corrupted',
      homeId: activeHomeId,
      error: 'Session schema version mismatch or malformed structure',
    }
  }

  try {
    const balancesResponse: BalancesResponse = await apiClient.getBalances(activeHomeId)

    // Authoritative members derived from server balances directly (no stale member appending)
    const authoritativeMembers: Member[] = balancesResponse.balances.map((b) => ({
      id: b.memberId,
      homeId: activeHomeId,
      name: b.name,
    }))

    // Restore pendingMemberCreation from the stored session.
    // Do not discard it just because GET balances returns 200.
    // Only resolve it when the authoritative roster contains exactly one newly observed matching member ID.
    let activePendingCreation = session.pendingMemberCreation ?? null
    if (activePendingCreation) {
      const pending = activePendingCreation
      const baselineSet = new Set(pending.baselineMemberIds)
      const newlyObserved = authoritativeMembers.filter((m) => !baselineSet.has(m.id))
      const matchingNew = newlyObserved.filter((m) => m.name === pending.name)

      if (matchingNew.length === 1) {
        activePendingCreation = null
      }
    }

    const updatedSession: StoredHomeSession = {
      ...session,
      members: authoritativeMembers,
      cachedBalances: balancesResponse.balances,
      pendingMemberCreation: activePendingCreation,
      updatedAt: new Date().toISOString(),
    }

    const saved = saveHomeSession(updatedSession, targetStorage)
    return {
      status: 'ready',
      homeId: activeHomeId,
      session: updatedSession,
      persistenceWarning: saved
        ? undefined
        : 'Session updated from server, but local storage could not save your session. Changes may not survive a page reload.',
    }
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) {
      // Confirmed 404: Household does not exist on server. Clear only this home's data.
      clearActiveHomeId(targetStorage)
      clearHomeSession(activeHomeId, targetStorage)
      return {
        status: 'invalid_home',
        homeId: activeHomeId,
        error: 'Household not found on server. It may have been deleted or database was reset.',
      }
    }

    const isNetwork =
      (err instanceof ApiClientError && err.status === 0) ||
      err instanceof TypeError ||
      (err instanceof Error && /network|fetch|connection/i.test(err.message))
    const is5xx = err instanceof ApiClientError && err.status >= 500

    if (isNetwork || is5xx) {
      // Network offline (status 0) or server 5xx: preserve local session
      return {
        status: 'api_unavailable',
        homeId: activeHomeId,
        session,
        error: err instanceof Error ? err.message : 'Network error',
      }
    }

    // Other 4xx HTTP error (e.g. 400, 422) or malformed payload: preserve local session, flag stale
    return {
      status: 'stale',
      homeId: activeHomeId,
      session,
      error: err instanceof Error ? err.message : 'Balance refresh failed',
    }
  }
}

export type AddMemberResult =
  | {
      status: 'success'
      member: Member
      session: StoredHomeSession
      persistenceWarning?: string
    }
  | {
      status: 'api_unavailable'
      member: Member
      session: StoredHomeSession
      error: string
      persistenceWarning?: string
    }
  | {
      status: 'stale'
      member: Member
      session: StoredHomeSession
      error: string
      persistenceWarning?: string
    }
  | {
      status: 'uncertain'
      pendingMember: PendingMemberCreation
      session: StoredHomeSession
      error: string
      persistenceWarning?: string
    }
  | { status: 'invalid_home'; error: string }
  | { status: 'error'; error: string }

/**
 * Adds a new member to an active household session.
 *
 * Requirements:
 * 1. Calls apiClient.createMember(homeId, name).
 * 2. If createMember fails with a network error (status 0) or timeout (504):
 *    Attempts safe reconciliation using the authoritative balances endpoint.
 *    Compares server member IDs with the pre-request roster (never by name alone).
 *    Treats a single newly observed matching member as reconciled success.
 *    If no matching new ID is found, keeps the outcome uncertain and preserves pending member info.
 *    Does NOT tell the user it is safe to retry.
 * 3. On success, refreshes authoritative balances via apiClient.getBalances(homeId).
 * 4. When refresh succeeds, uses the exact complete server member roster.
 * 5. When refresh fails with network 0 or 5xx, produces api_unavailable.
 * 6. When refresh fails with other HTTP error or malformed 2xx, preserves member
 *    and balances without falsely labelling offline (produces stale).
 * 7. When confirmed 404 occurs, cleans storage and returns invalid_home.
 * 8. If saveHomeSession fails on any path, retains the updated session in memory
 *    and attaches a persistenceWarning.
 */
export async function addHouseholdMember(
  apiClient: ApiClient,
  currentSession: StoredHomeSession,
  name: string,
  storage?: Storage | null,
): Promise<AddMemberResult> {
  const targetStorage = getSafeStorage(storage)
  const trimmed = name.trim()
  if (!trimmed) {
    return { status: 'error', error: 'Resident name cannot be empty' }
  }

  const baselineMemberIds = currentSession.members.map((m) => m.id)
  const baselineMemberIdSet = new Set(baselineMemberIds)

  let newMember: Member
  try {
    newMember = await apiClient.createMember(currentSession.home.id, trimmed)
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) {
      clearActiveHomeId(targetStorage)
      clearHomeSession(currentSession.home.id, targetStorage)
      return {
        status: 'invalid_home',
        error: 'Household not found on server. It may have been deleted or database was reset.',
      }
    }

    // Network failure during POST /members (status 0) or gateway timeout (status 504)
    // The request may have reached the server before the connection dropped.
    if (err instanceof ApiClientError && (err.status === 0 || err.status === 504)) {
      try {
        const balancesResponse = await apiClient.getBalances(currentSession.home.id)
        const serverMembers: Member[] = balancesResponse.balances.map((b) => ({
          id: b.memberId,
          homeId: currentSession.home.id,
          name: b.name,
        }))

        // Never identify a newly created member by name alone.
        // Compare server member IDs with the pre-request roster.
        const newlyObservedMembers = serverMembers.filter((m) => !baselineMemberIdSet.has(m.id))
        const matchingNewMembers = newlyObservedMembers.filter((m) => m.name === trimmed)

        // Treat a single newly observed matching member as reconciled success
        if (matchingNewMembers.length === 1 && matchingNewMembers[0]) {
          const reconciledMember = matchingNewMembers[0]
          const updatedSession: StoredHomeSession = {
            ...currentSession,
            members: serverMembers,
            cachedBalances: balancesResponse.balances,
            pendingMemberCreation: null,
            updatedAt: new Date().toISOString(),
          }
          const saved = saveHomeSession(updatedSession, targetStorage)
          return {
            status: 'success',
            member: reconciledMember,
            session: updatedSession,
            persistenceWarning: saved
              ? undefined
              : 'Resident created on server, but local storage could not save your session. This change may not survive a page reload.',
          }
        }

        // If no matching new ID is found, keep the outcome uncertain.
        // Do NOT tell the user it is safe to retry after a single immediate GET balances response shows no matching member.
        const pendingMember: PendingMemberCreation = { name: trimmed, baselineMemberIds }
        const updatedSession: StoredHomeSession = {
          ...currentSession,
          members: serverMembers,
          cachedBalances: balancesResponse.balances,
          pendingMemberCreation: pendingMember,
          updatedAt: new Date().toISOString(),
        }
        const saved = saveHomeSession(updatedSession, targetStorage)
        return {
          status: 'uncertain',
          pendingMember,
          session: updatedSession,
          error: `Network failure during resident creation for "${trimmed}". The outcome cannot yet be confirmed. To prevent duplicate entries, do not retry immediately. Use "Reconcile with Server" once connectivity is restored.`,
          persistenceWarning: saved
            ? undefined
            : 'Session updated in memory, but local storage could not save your session. Changes may not survive a page reload.',
        }
      } catch (errBalances) {
        if (errBalances instanceof ApiClientError && errBalances.status === 404) {
          clearActiveHomeId(targetStorage)
          clearHomeSession(currentSession.home.id, targetStorage)
          return {
            status: 'invalid_home',
            error: 'Household not found on server. It may have been deleted or database was reset.',
          }
        }

        // Balances endpoint also unreachable or failed: outcome remains uncertain
        const pendingMember: PendingMemberCreation = { name: trimmed, baselineMemberIds }
        const updatedSession: StoredHomeSession = {
          ...currentSession,
          pendingMemberCreation: pendingMember,
          updatedAt: new Date().toISOString(),
        }
        const saved = saveHomeSession(updatedSession, targetStorage)
        return {
          status: 'uncertain',
          pendingMember,
          session: updatedSession,
          error: `Network failure during resident creation for "${trimmed}". The outcome cannot yet be confirmed. To prevent duplicate entries, do not retry immediately. Use "Reconcile with Server" once connectivity is restored.`,
          persistenceWarning: saved
            ? undefined
            : 'Session updated in memory, but local storage could not save your session. Changes may not survive a page reload.',
        }
      }
    }

    return {
      status: 'error',
      error: err instanceof Error ? err.message : 'Failed to add resident',
    }
  }

  try {
    const balancesResponse = await apiClient.getBalances(currentSession.home.id)
    const serverMembers: Member[] = balancesResponse.balances.map((b) => ({
      id: b.memberId,
      homeId: currentSession.home.id,
      name: b.name,
    }))

    const updatedSession: StoredHomeSession = {
      ...currentSession,
      members: serverMembers,
      cachedBalances: balancesResponse.balances,
      pendingMemberCreation: null,
      updatedAt: new Date().toISOString(),
    }

    const saved = saveHomeSession(updatedSession, targetStorage)
    return {
      status: 'success',
      member: newMember,
      session: updatedSession,
      persistenceWarning: saved
        ? undefined
        : 'Resident added on server, but local storage could not save your session. This change may not survive a page reload.',
    }
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) {
      clearActiveHomeId(targetStorage)
      clearHomeSession(currentSession.home.id, targetStorage)
      return {
        status: 'invalid_home',
        error: 'Household not found on server. It may have been deleted or database was reset.',
      }
    }

    // Preserve newly created member locally alongside existing members and retain prior cached balances
    const updatedSession: StoredHomeSession = {
      ...currentSession,
      members: [...currentSession.members, newMember],
      cachedBalances: currentSession.cachedBalances,
      pendingMemberCreation: null,
      updatedAt: new Date().toISOString(),
    }

    const saved = saveHomeSession(updatedSession, targetStorage)
    const persistenceWarning = saved
      ? undefined
      : 'Resident preserved in memory, but local storage could not save your session. This change may not survive a page reload.'

    if (err instanceof ApiClientError && (err.status === 0 || err.status >= 500)) {
      // Network failure (0) or server 5xx error: confirmed offline/unavailable
      return {
        status: 'api_unavailable',
        member: newMember,
        session: updatedSession,
        error: err.message,
        persistenceWarning,
      }
    }

    // Other HTTP error (e.g. 400, 422) or malformed 2xx response:
    // Preserve member and balances, but DO NOT falsely label offline or blame server
    return {
      status: 'stale',
      member: newMember,
      session: updatedSession,
      error: err instanceof Error ? err.message : 'Balance refresh could not be verified',
      persistenceWarning,
    }
  }
}

export type ReconcileRosterResult =
  | {
      status: 'ready'
      session: StoredHomeSession
      resolvedPending?: boolean
      reconciledMember?: Member
      pendingMember?: PendingMemberCreation
      error?: string
      persistenceWarning?: string
    }
  | { status: 'invalid_home'; error: string }
  | { status: 'api_unavailable'; session: StoredHomeSession; error: string }
  | { status: 'stale'; session: StoredHomeSession; error: string }

/**
 * Reconciles household roster and balances with the authoritative server endpoint.
 */
export async function reconcileHouseholdRoster(
  apiClient: ApiClient,
  currentSession: StoredHomeSession,
  pendingMember?: PendingMemberCreation | null,
  storage?: Storage | null,
): Promise<ReconcileRosterResult> {
  const targetStorage = getSafeStorage(storage)
  const activePending = pendingMember ?? currentSession.pendingMemberCreation ?? null

  try {
    const balancesResponse = await apiClient.getBalances(currentSession.home.id)
    const serverMembers: Member[] = balancesResponse.balances.map((b) => ({
      id: b.memberId,
      homeId: currentSession.home.id,
      name: b.name,
    }))

    let resolvedPending = false
    let reconciledMember: Member | undefined
    let remainingPending: PendingMemberCreation | null = activePending

    if (activePending) {
      const baselineSet = new Set(activePending.baselineMemberIds)
      const newlyObserved = serverMembers.filter((m) => !baselineSet.has(m.id))
      const matchingNew = newlyObserved.filter((m) => m.name === activePending.name)

      if (matchingNew.length === 1 && matchingNew[0]) {
        resolvedPending = true
        reconciledMember = matchingNew[0]
        remainingPending = null
      }
    }

    const updatedSession: StoredHomeSession = {
      ...currentSession,
      members: serverMembers,
      cachedBalances: balancesResponse.balances,
      pendingMemberCreation: remainingPending,
      updatedAt: new Date().toISOString(),
    }

    const saved = saveHomeSession(updatedSession, targetStorage)
    const persistenceWarning = saved
      ? undefined
      : 'Roster updated from server, but local storage could not save your session.'

    if (activePending) {
      if (resolvedPending) {
        return {
          status: 'ready',
          session: updatedSession,
          resolvedPending: true,
          reconciledMember,
          persistenceWarning,
        }
      }

      // If no matching new ID is found, keep the outcome uncertain.
      // Do not clear the uncertain warning merely because GET balances returned 200.
      return {
        status: 'ready',
        session: updatedSession,
        resolvedPending: false,
        pendingMember: activePending,
        error: `Reconciliation checked the server, but resident "${activePending.name}" has not appeared yet. The outcome remains uncertain; avoid re-adding this resident to prevent duplicates.`,
        persistenceWarning,
      }
    }

    return {
      status: 'ready',
      session: updatedSession,
      persistenceWarning,
    }
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) {
      clearActiveHomeId(targetStorage)
      clearHomeSession(currentSession.home.id, targetStorage)
      return {
        status: 'invalid_home',
        error: 'Household not found on server. It may have been deleted or database was reset.',
      }
    }

    if (err instanceof ApiClientError && (err.status === 0 || err.status >= 500)) {
      return {
        status: 'api_unavailable',
        session: currentSession,
        error: err.message,
      }
    }

    return {
      status: 'stale',
      session: currentSession,
      error: err instanceof Error ? err.message : 'Balance reconciliation could not be verified',
    }
  }
}

/* ==========================================================================
   Bill Persistence, Metrics & History
   ========================================================================== */

export interface BillMetrics {
  totalIncurredCents: number
  settledCents: number
  pendingCents: number
}

/**
 * Calculates total incurred, settled, and pending amounts from real bill data.
 * Guarantees totalIncurredCents === settledCents + pendingCents.
 */
export function calculateBillMetrics(bills: readonly StoredBill[]): BillMetrics {
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

  return {
    totalIncurredCents,
    settledCents,
    pendingCents,
  }
}

/**
 * Formats an ISO timestamp for bill history display (e.g., "Recorded Nov 6, 2026").
 */
export function formatBillDate(isoDateString: string): string {
  try {
    const d = new Date(isoDateString)
    if (Number.isNaN(d.getTime())) return 'Recorded recently'
    const formatted = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    return `Recorded ${formatted}`
  } catch {
    return 'Recorded recently'
  }
}

export interface AddBillResult {
  status: 'success' | 'api_unavailable' | 'stale' | 'invalid_home' | 'error'
  bill?: StoredBill
  session?: StoredHomeSession
  error?: string
  persistenceWarning?: string
}

/**
 * Creates a bill on the server, appends it to session.bills, refreshes authoritative balances,
 * and persists the updated session to storage with failure observability.
 */
export async function addHouseholdBill(
  apiClient: ApiClient,
  currentSession: StoredHomeSession,
  title: string,
  totalCents: number,
  storage?: Storage | null,
): Promise<AddBillResult> {
  const targetStorage = getSafeStorage(storage)
  const trimmedTitle = title.trim()

  let createdBill: CreateBillResponse
  try {
    createdBill = await apiClient.createBill(currentSession.home.id, trimmedTitle, totalCents)
  } catch (err: unknown) {
    if (err instanceof ApiClientError && err.status === 404) {
      clearActiveHomeId(targetStorage)
      clearHomeSession(currentSession.home.id, targetStorage)
      return {
        status: 'invalid_home',
        error: 'Household not found on server. It may have been deleted or database was reset.',
      }
    }
    return {
      status: 'error',
      error: err instanceof Error ? err.message : 'Failed to create bill on server.',
    }
  }

  const storedBill: StoredBill = {
    id: createdBill.id,
    homeId: createdBill.homeId,
    title: createdBill.title,
    totalCents: createdBill.totalCents,
    shares: createdBill.shares.map((s: Share) => ({
      id: s.id,
      memberId: s.memberId,
      amountCents: s.amountCents,
      paidAt: s.paidAt,
      pendingIdempotencyKey: null,
    })),
    clientCreatedAt: new Date().toISOString(),
  }

  // Refresh authoritative balances so member balances reflect the newly incurred bill
  let updatedMembers: Member[] = currentSession.members
  let updatedBalances: MemberBalance[] | null = currentSession.cachedBalances ?? null
  let refreshWarning: string | undefined

  try {
    const balancesResponse = await apiClient.getBalances(currentSession.home.id)
    updatedMembers = balancesResponse.balances.map((b) => ({
      id: b.memberId,
      homeId: currentSession.home.id,
      name: b.name,
    }))
    updatedBalances = balancesResponse.balances
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) {
      clearActiveHomeId(targetStorage)
      clearHomeSession(currentSession.home.id, targetStorage)
      return {
        status: 'invalid_home',
        error: 'Household not found on server. It may have been deleted or database was reset.',
      }
    }
    refreshWarning = 'Bill recorded, but balances could not be refreshed from the server.'
  }

  const updatedSession: StoredHomeSession = {
    ...currentSession,
    bills: [...currentSession.bills, storedBill],
    members: updatedMembers,
    cachedBalances: updatedBalances,
    updatedAt: new Date().toISOString(),
  }

  const saved = saveHomeSession(updatedSession, targetStorage)
  const persistenceWarning = saved
    ? refreshWarning
    : 'Bill recorded on server, but local storage could not save your session. This bill may not survive a page reload.'

  return {
    status: 'success',
    bill: storedBill,
    session: updatedSession,
    persistenceWarning,
  }
}
