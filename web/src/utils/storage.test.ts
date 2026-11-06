import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiClient } from '../api/client.ts'
import type { BalancesResponse, PayShareResponse, StoredHomeSession } from '../api/types.ts'
import { ACTIVE_HOME_STORAGE_KEY, getHomeStorageKey } from '../api/types.ts'
import {
  addHouseholdBill,
  addHouseholdMember,
  clearActiveHomeId,
  clearHomeSession,
  initializeHomeSession,
  isHome,
  isMember,
  isMemberBalance,
  isStoredBill,
  isStoredShare,
  loadActiveHomeId,
  loadHomeSession,
  payHouseholdShare,
  persistNewHouseholdSession,
  reconcileHouseholdRoster,
  restoreHouseholdSession,
  saveActiveHomeId,
  saveHomeSession,
  validateHomeSession,
} from './storage.ts'

function createMockStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }
}

describe('Storage Type Guards and Schema Validation', () => {
  it('validates Home objects', () => {
    assert.strictEqual(isHome({ id: 'h1', name: 'Downtown Loft' }), true)
    assert.strictEqual(isHome(null), false)
    assert.strictEqual(isHome({ id: 'h1' }), false)
    assert.strictEqual(isHome({ id: 123, name: 'Downtown Loft' }), false)
  })

  it('validates Member objects', () => {
    assert.strictEqual(isMember({ id: 'm1', homeId: 'h1', name: 'Julian' }), true)
    assert.strictEqual(isMember({ id: 'm1', name: 'Julian' }), false)
    assert.strictEqual(isMember({ id: 'm1', homeId: 123, name: 'Julian' }), false)
  })

  it('validates StoredShare and rejects invalid monetary values', () => {
    assert.strictEqual(
      isStoredShare({
        id: 's1',
        memberId: 'm1',
        amountCents: 5000,
        paidAt: null,
        pendingIdempotencyKey: 'idem-1',
      }),
      true,
    )
    assert.strictEqual(
      isStoredShare({
        id: 's1',
        memberId: 'm1',
        amountCents: 5000,
        paidAt: '2026-11-06T00:00:00Z',
      }),
      true,
    )
    assert.strictEqual(
      isStoredShare({
        id: 's1',
        memberId: 'm1',
        amountCents: -10,
        paidAt: null,
      }),
      false,
    )
    assert.strictEqual(
      isStoredShare({
        id: 's1',
        memberId: 'm1',
        amountCents: 12.5,
        paidAt: null,
      }),
      false,
    )
  })

  it('validates StoredBill and rejects invalid bill totals', () => {
    assert.strictEqual(
      isStoredBill({
        id: 'b1',
        homeId: 'h1',
        title: 'Electricity',
        totalCents: 12000,
        clientCreatedAt: '2026-11-06T00:00:00Z',
        shares: [
          {
            id: 's1',
            memberId: 'm1',
            amountCents: 6000,
            paidAt: null,
          },
        ],
      }),
      true,
    )
    assert.strictEqual(
      isStoredBill({
        id: 'b1',
        homeId: 'h1',
        title: 'Electricity',
        totalCents: 0,
        clientCreatedAt: '2026-11-06T00:00:00Z',
        shares: [],
      }),
      false,
    )
  })

  it('validates MemberBalance', () => {
    assert.strictEqual(
      isMemberBalance({
        memberId: 'm1',
        name: 'Julian',
        outstandingCents: 8500,
      }),
      true,
    )
    assert.strictEqual(
      isMemberBalance({
        memberId: 'm1',
        name: 'Julian',
        outstandingCents: -1,
      }),
      false,
    )
  })

  it('validates complete StoredHomeSession and rejects version mismatch', () => {
    const validSession: StoredHomeSession = {
      version: 1,
      home: { id: 'h1', name: 'Downtown Loft' },
      members: [{ id: 'm1', homeId: 'h1', name: 'Julian' }],
      bills: [],
      cachedBalances: [{ memberId: 'm1', name: 'Julian', outstandingCents: 0 }],
      updatedAt: '2026-11-06T00:00:00Z',
    }

    assert.notStrictEqual(validateHomeSession(validSession), null)

    // Version 2 should be rejected
    assert.strictEqual(validateHomeSession({ ...validSession, version: 2 as unknown as 1 }), null)

    // Missing home should be rejected
    assert.strictEqual(
      validateHomeSession({ ...validSession, home: null as unknown as StoredHomeSession['home'] }),
      null,
    )

    // Validates pendingMemberCreation when present
    assert.notStrictEqual(
      validateHomeSession({
        ...validSession,
        pendingMemberCreation: { name: 'Elena', baselineMemberIds: ['m1'] },
      }),
      null,
    )

    // Rejects malformed pendingMemberCreation
    assert.strictEqual(
      validateHomeSession({
        ...validSession,
        pendingMemberCreation: { name: 123, baselineMemberIds: ['m1'] },
      }),
      null,
    )
    assert.strictEqual(
      validateHomeSession({
        ...validSession,
        pendingMemberCreation: { name: 'Elena', baselineMemberIds: 'not-array' },
      }),
      null,
    )
  })
})

describe('Storage Primitives', () => {
  it('loads, saves and clears active home ID returning observable booleans', () => {
    const storage = createMockStorage()
    assert.strictEqual(loadActiveHomeId(storage), null)

    const saved = saveActiveHomeId('home-123', storage)
    assert.strictEqual(saved, true)
    assert.strictEqual(loadActiveHomeId(storage), 'home-123')

    clearActiveHomeId(storage)
    assert.strictEqual(loadActiveHomeId(storage), null)

    // Observable persistence failure when setItem throws
    const throwingStorage: Storage = {
      ...storage,
      setItem() {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      },
    }
    const failedSave = saveActiveHomeId('home-fail', throwingStorage)
    assert.strictEqual(failedSave, false)

    // Observable persistence failure when storage is null
    assert.strictEqual(saveActiveHomeId('home-null', null), false)
  })

  it('loads, saves and clears versioned home session returning observable booleans', () => {
    const storage = createMockStorage()
    const session = initializeHomeSession({ id: 'h-456', name: 'North Park' })

    const saved = saveHomeSession(session, storage)
    assert.strictEqual(saved, true)
    const loaded = loadHomeSession('h-456', storage)
    assert.deepStrictEqual(loaded, session)

    clearHomeSession('h-456', storage)
    assert.strictEqual(loadHomeSession('h-456', storage), null)

    // Observable persistence failure when setItem throws
    const throwingStorage: Storage = {
      ...storage,
      setItem() {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      },
    }
    const failedSave = saveHomeSession(session, throwingStorage)
    assert.strictEqual(failedSave, false)

    // Observable persistence failure when storage is null
    assert.strictEqual(saveHomeSession(session, null), false)
  })

  it('persistNewHouseholdSession persists session before active home ID and handles failures correctly', () => {
    const storage = createMockStorage()
    const home = { id: 'h-order', name: 'Order Test Home' }

    // Case 1: Full success
    const result1 = persistNewHouseholdSession(home, storage)
    assert.strictEqual(result1.sessionSaved, true)
    assert.strictEqual(result1.activeIdSaved, true)
    assert.strictEqual(result1.session.home.id, 'h-order')
    assert.strictEqual(loadActiveHomeId(storage), 'h-order')
    assert.strictEqual(loadHomeSession('h-order', storage)?.home.name, 'Order Test Home')

    // Case 2: Session storage fails; must NOT write active ID
    const failSessionStorage: Storage = {
      ...createMockStorage(),
      setItem(key) {
        if (key.startsWith('bill_splitter_home_')) {
          throw new DOMException('Disk full', 'QuotaExceededError')
        }
      },
    }
    const result2 = persistNewHouseholdSession(home, failSessionStorage)
    assert.strictEqual(result2.sessionSaved, false)
    assert.strictEqual(result2.activeIdSaved, false)
    // In-memory session is still initialized and returned
    assert.strictEqual(result2.session.home.name, 'Order Test Home')
    // Active ID must not have been set
    assert.strictEqual(loadActiveHomeId(failSessionStorage), null)

    // Case 3: Session succeeds, active ID fails
    const failActiveIdStorage: Storage = {
      ...createMockStorage(),
      setItem(key, value) {
        if (key === ACTIVE_HOME_STORAGE_KEY) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError')
        }
        createMockStorage().setItem(key, value)
      },
    }
    const result3 = persistNewHouseholdSession(home, failActiveIdStorage)
    assert.strictEqual(result3.sessionSaved, true)
    assert.strictEqual(result3.activeIdSaved, false)
    assert.strictEqual(result3.session.home.name, 'Order Test Home')
  })
})

describe('restoreHouseholdSession Recovery Sequence', () => {
  it('returns status fresh when no active household is in storage', async () => {
    const storage = createMockStorage()
    const client = new ApiClient('http://localhost:3000')
    const result = await restoreHouseholdSession(client, storage)
    assert.deepStrictEqual(result, { status: 'fresh' })
  })

  it('handles accessing window.localStorage property itself throwing SecurityError', async () => {
    const originalWindow = globalThis.window
    try {
      const mockWindow = {}
      Object.defineProperty(mockWindow, 'localStorage', {
        get() {
          throw new DOMException('Access denied', 'SecurityError')
        },
        configurable: true,
      })
      globalThis.window = mockWindow as unknown as Window & typeof globalThis

      const client = new ApiClient('http://localhost:3000')
      // Must call without passing storage argument so it resolves window.localStorage safely
      const result = await restoreHouseholdSession(client)
      assert.strictEqual(result.status, 'corrupted')
      assert.match(result.error ?? '', /SecurityError|Access denied/i)

      // Storage primitives must also not crash when localStorage property access throws
      assert.strictEqual(loadActiveHomeId(), null)
      assert.strictEqual(loadHomeSession('h-1'), null)
      assert.doesNotThrow(() => saveActiveHomeId('h-1'))
      assert.doesNotThrow(() => clearActiveHomeId())
      assert.doesNotThrow(() => clearHomeSession('h-1'))
    } finally {
      globalThis.window = originalWindow
    }
  })

  it('handles storage.getItem() SecurityError without crashing or mistaking for fresh browser', async () => {
    const throwingStorage: Storage = {
      get length() {
        return 0
      },
      clear() {},
      getItem() {
        throw new DOMException('Access denied', 'SecurityError')
      },
      key() {
        return null
      },
      removeItem() {},
      setItem() {},
    }

    const client = new ApiClient('http://localhost:3000')
    const result = await restoreHouseholdSession(client, throwingStorage)
    assert.strictEqual(result.status, 'corrupted')
    assert.match(result.error ?? '', /SecurityError|Access denied/i)
  })

  it('handles storage.getItem() SecurityError on session key retrieval', async () => {
    const throwingStorage: Storage = {
      get length() {
        return 1
      },
      clear() {},
      getItem(key: string) {
        if (key === ACTIVE_HOME_STORAGE_KEY) {
          return 'h-secure'
        }
        throw new DOMException('Session access restricted', 'SecurityError')
      },
      key() {
        return null
      },
      removeItem() {},
      setItem() {},
    }

    const client = new ApiClient('http://localhost:3000')
    const result = await restoreHouseholdSession(client, throwingStorage)
    assert.strictEqual(result.status, 'corrupted')
    assert.strictEqual(result.homeId, 'h-secure')
    assert.match(result.error ?? '', /SecurityError|restricted/i)
  })

  it('clears invalid or corrupted session to avoid repeatedly restoring it on reload', async () => {
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-corrupt',
      [getHomeStorageKey('h-corrupt')]: '{ malformed json',
    })
    const client = new ApiClient('http://localhost:3000')

    const firstResult = await restoreHouseholdSession(client, storage)
    assert.strictEqual(firstResult.status, 'corrupted')

    // Corrupted session keys must be cleaned up from storage
    assert.strictEqual(loadActiveHomeId(storage), null)
    assert.strictEqual(loadHomeSession('h-corrupt', storage), null)

    // Subsequent reload does not hit corrupted session loop; starts fresh
    const subsequentResult = await restoreHouseholdSession(client, storage)
    assert.strictEqual(subsequentResult.status, 'fresh')
  })

  it('clears schema-incompatible session to avoid repeatedly restoring it on reload', async () => {
    const invalidSchemaSession = {
      version: 999, // Incompatible version
      home: { id: 'h-old', name: 'Old Home' },
    }
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-old',
      [getHomeStorageKey('h-old')]: JSON.stringify(invalidSchemaSession),
    })
    const client = new ApiClient('http://localhost:3000')

    const firstResult = await restoreHouseholdSession(client, storage)
    assert.strictEqual(firstResult.status, 'corrupted')

    // Cleaned up
    assert.strictEqual(loadActiveHomeId(storage), null)

    const nextResult = await restoreHouseholdSession(client, storage)
    assert.strictEqual(nextResult.status, 'fresh')
  })

  it('returns status invalid_home and cleans up storage when server returns 404', async () => {
    const session = initializeHomeSession({ id: 'h-404', name: 'Ghost House' })
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-404',
      [getHomeStorageKey('h-404')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: 'Home not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })

      const client = new ApiClient()
      const result = await restoreHouseholdSession(client, storage)
      assert.strictEqual(result.status, 'invalid_home')
      if (result.status === 'invalid_home') {
        assert.strictEqual(result.homeId, 'h-404')
      }

      // Must clear invalid home data from storage
      assert.strictEqual(loadActiveHomeId(storage), null)
      assert.strictEqual(loadHomeSession('h-404', storage), null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns status api_unavailable and preserves storage on network or server error', async () => {
    const session = initializeHomeSession({
      id: 'h-offline',
      name: 'Offline Cabin',
    })
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-offline',
      [getHomeStorageKey('h-offline')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () => {
        throw new TypeError('Failed to fetch')
      }

      const client = new ApiClient()
      const result = await restoreHouseholdSession(client, storage)
      assert.strictEqual(result.status, 'api_unavailable')
      if (result.status === 'api_unavailable' && result.session) {
        assert.strictEqual(result.session.home.name, 'Offline Cabin')
      }

      // Must PRESERVE storage (do not delete valid session when API is offline)
      assert.strictEqual(loadActiveHomeId(storage), 'h-offline')
      assert.notStrictEqual(loadHomeSession('h-offline', storage), null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns status api_unavailable and preserves pendingMemberCreation on server 5xx error', async () => {
    const session: StoredHomeSession = {
      version: 1,
      home: { id: 'h-503', name: '503 Cabin' },
      members: [{ id: 'm-1', homeId: 'h-503', name: 'Julian' }],
      bills: [],
      cachedBalances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 1000 }],
      pendingMemberCreation: { name: 'Elena', baselineMemberIds: ['m-1'] },
      updatedAt: new Date().toISOString(),
    }
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-503',
      [getHomeStorageKey('h-503')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: 'Service Unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })

      const client = new ApiClient()
      const result = await restoreHouseholdSession(client, storage)
      assert.strictEqual(result.status, 'api_unavailable')
      assert.ok(result.session)
      assert.strictEqual(result.session.home.name, '503 Cabin')
      assert.strictEqual(result.session.pendingMemberCreation?.name, 'Elena')
      assert.deepStrictEqual(result.session.pendingMemberCreation?.baselineMemberIds, ['m-1'])

      // Storage preserved
      const stored = loadHomeSession('h-503', storage)
      assert.strictEqual(stored?.pendingMemberCreation?.name, 'Elena')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns status stale and preserves pendingMemberCreation on other 4xx client errors (400, 422)', async () => {
    const session: StoredHomeSession = {
      version: 1,
      home: { id: 'h-422', name: '422 Flat' },
      members: [{ id: 'm-1', homeId: 'h-422', name: 'Julian' }],
      bills: [],
      cachedBalances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 1000 }],
      pendingMemberCreation: { name: 'Marcus', baselineMemberIds: ['m-1'] },
      updatedAt: new Date().toISOString(),
    }
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-422',
      [getHomeStorageKey('h-422')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: 'Unprocessable Entity' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        })

      const client = new ApiClient()
      const result = await restoreHouseholdSession(client, storage)
      assert.strictEqual(result.status, 'stale')
      assert.ok(result.session)
      assert.strictEqual(result.session.home.name, '422 Flat')
      assert.strictEqual(result.session.pendingMemberCreation?.name, 'Marcus')
      assert.deepStrictEqual(result.session.pendingMemberCreation?.baselineMemberIds, ['m-1'])

      // Storage preserved
      const stored = loadHomeSession('h-422', storage)
      assert.strictEqual(stored?.pendingMemberCreation?.name, 'Marcus')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns status stale and preserves pendingMemberCreation on malformed responses', async () => {
    const session: StoredHomeSession = {
      version: 1,
      home: { id: 'h-malformed', name: 'Malformed Flat' },
      members: [{ id: 'm-1', homeId: 'h-malformed', name: 'Julian' }],
      bills: [],
      cachedBalances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 1000 }],
      pendingMemberCreation: { name: 'Elena', baselineMemberIds: ['m-1'] },
      updatedAt: new Date().toISOString(),
    }
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-malformed',
      [getHomeStorageKey('h-malformed')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      // 1. Invalid JSON body with status 200
      globalThis.fetch = async () =>
        new Response('<html><body>Error page</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })

      const client = new ApiClient()
      const result1 = await restoreHouseholdSession(client, storage)
      assert.strictEqual(result1.status, 'stale')
      assert.ok(result1.session)
      assert.strictEqual(result1.session.pendingMemberCreation?.name, 'Elena')

      // 2. Valid JSON but invalid schema with status 200
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ wrongPayload: [1, 2, 3] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })

      const result2 = await restoreHouseholdSession(client, storage)
      assert.strictEqual(result2.status, 'stale')
      assert.ok(result2.session)
      assert.strictEqual(result2.session.pendingMemberCreation?.name, 'Elena')

      // Storage preserved
      const stored = loadHomeSession('h-malformed', storage)
      assert.strictEqual(stored?.pendingMemberCreation?.name, 'Elena')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('uses exact authoritative server member roster and does not append stale local members', async () => {
    // Initial session has stale local member 'Old Stale Resident' not in server database
    const initialSession: StoredHomeSession = {
      version: 1,
      home: { id: 'h-live', name: 'Sunny Flat' },
      members: [
        { id: 'm-1', homeId: 'h-live', name: 'Julian' },
        { id: 'm-stale', homeId: 'h-live', name: 'Old Stale Resident' },
      ],
      bills: [],
      cachedBalances: [
        { memberId: 'm-1', name: 'Julian', outstandingCents: 6000 },
        { memberId: 'm-stale', name: 'Old Stale Resident', outstandingCents: 0 },
      ],
      updatedAt: '2026-11-06T00:00:00Z',
    }

    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-live',
      [getHomeStorageKey('h-live')]: JSON.stringify(initialSession),
    })

    // Server authoritative balances only have Julian and Elena
    const mockBalances: BalancesResponse = {
      balances: [
        { memberId: 'm-1', name: 'Julian', outstandingCents: 6000 },
        { memberId: 'm-2', name: 'Elena', outstandingCents: 4000 },
      ],
    }

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify(mockBalances), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })

      const client = new ApiClient()
      const result = await restoreHouseholdSession(client, storage)
      assert.strictEqual(result.status, 'ready')
      if (result.status === 'ready' && result.session) {
        // Authoritative server roster must be exact: 2 members, without stale local member
        assert.strictEqual(result.session.members.length, 2)
        assert.strictEqual(result.session.members[0]?.id, 'm-1')
        assert.strictEqual(result.session.members[0]?.name, 'Julian')
        assert.strictEqual(result.session.members[1]?.id, 'm-2')
        assert.strictEqual(result.session.members[1]?.name, 'Elena')
        assert.strictEqual(
          result.session.members.some((m) => m.id === 'm-stale'),
          false,
        )
        assert.deepStrictEqual(result.session.cachedBalances, mockBalances.balances)
      }

      // Persisted storage must also have the exact roster
      const persisted = loadHomeSession('h-live', storage)
      assert.strictEqual(persisted?.members.length, 2)
      assert.strictEqual(
        persisted?.members.some((m) => m.id === 'm-stale'),
        false,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('surfaces a persistence warning without discarding the in-memory session when localStorage write fails during session restoration', async () => {
    const validSession = initializeHomeSession({
      id: 'h-restore-fail',
      name: 'Restore Warning Home',
    })
    const store = new Map<string, string>([
      [ACTIVE_HOME_STORAGE_KEY, 'h-restore-fail'],
      [getHomeStorageKey('h-restore-fail'), JSON.stringify(validSession)],
    ])

    const failingStorage: Storage = {
      get length() {
        return store.size
      },
      clear() {
        store.clear()
      },
      getItem(key) {
        return store.get(key) ?? null
      },
      key(index) {
        return Array.from(store.keys())[index] ?? null
      },
      removeItem(key) {
        store.delete(key)
      },
      setItem() {
        throw new DOMException('Storage full', 'QuotaExceededError')
      },
    }

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            balances: [{ memberId: 'm-server', name: 'Julian', outstandingCents: 2000 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )

      const client = new ApiClient()
      const result = await restoreHouseholdSession(client, failingStorage)

      assert.strictEqual(result.status, 'ready')
      if (result.status === 'ready') {
        assert.notStrictEqual(result.session, null)
        assert.strictEqual(result.session?.members.length, 1)
        assert.strictEqual(result.session?.members[0]?.id, 'm-server')
        assert.match(result.persistenceWarning ?? '', /local storage could not save/i)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('addHouseholdMember Workflow & Balance Refresh Failure Handling', () => {
  it('uses complete server member roster when balance refresh succeeds after member creation', async () => {
    const session = initializeHomeSession({ id: 'h-100', name: 'Waverly' })
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
      [getHomeStorageKey('h-100')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      let callCount = 0
      globalThis.fetch = async (url) => {
        callCount++
        const urlStr = String(url)
        if (urlStr.includes('/members')) {
          // createMember succeeds
          return new Response(JSON.stringify({ id: 'm-new', homeId: 'h-100', name: 'Elena' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (urlStr.includes('/balances')) {
          // getBalances succeeds with authoritative roster
          const balances: BalancesResponse = {
            balances: [{ memberId: 'm-new', name: 'Elena', outstandingCents: 0 }],
          }
          return new Response(JSON.stringify(balances), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error('Unexpected URL')
      }

      const client = new ApiClient()
      const result = await addHouseholdMember(client, session, 'Elena', storage)
      assert.strictEqual(result.status, 'success')
      if (result.status === 'success') {
        assert.strictEqual(result.member.name, 'Elena')
        assert.strictEqual(result.session.members.length, 1)
        assert.strictEqual(result.session.members[0]?.name, 'Elena')
        assert.deepStrictEqual(result.session.cachedBalances, [
          { memberId: 'm-new', name: 'Elena', outstandingCents: 0 },
        ])
      }
      assert.strictEqual(callCount, 2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('preserves newly created member and prior cached balances when refresh fails with network error', async () => {
    const priorBalances = [{ memberId: 'm-1', name: 'Julian', outstandingCents: 5000 }]
    const session: StoredHomeSession = {
      version: 1,
      home: { id: 'h-100', name: 'Waverly' },
      members: [{ id: 'm-1', homeId: 'h-100', name: 'Julian' }],
      bills: [],
      cachedBalances: priorBalances,
      updatedAt: '2026-11-06T00:00:00Z',
    }

    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
      [getHomeStorageKey('h-100')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/members')) {
          // Member creation succeeds on server
          return new Response(JSON.stringify({ id: 'm-2', homeId: 'h-100', name: 'Elena' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (urlStr.includes('/balances')) {
          // Balance refresh immediately encounters network disconnect
          throw new TypeError('Failed to fetch')
        }
        throw new Error('Unexpected URL')
      }

      const client = new ApiClient()
      const result = await addHouseholdMember(client, session, 'Elena', storage)

      // Network disconnect (status 0) must produce api_unavailable
      assert.strictEqual(result.status, 'api_unavailable')
      if (result.status === 'api_unavailable') {
        assert.strictEqual(result.member.name, 'Elena')
        // Preserves newly created member locally alongside Julian
        assert.strictEqual(result.session.members.length, 2)
        assert.strictEqual(result.session.members[0]?.name, 'Julian')
        assert.strictEqual(result.session.members[1]?.name, 'Elena')
        // Retains prior cached balances without inventing an unverified balance for Elena
        assert.deepStrictEqual(result.session.cachedBalances, priorBalances)
      }

      // Persisted session must have newly created member saved
      const persisted = loadHomeSession('h-100', storage)
      assert.strictEqual(persisted?.members.length, 2)
      assert.strictEqual(persisted?.members[1]?.name, 'Elena')
      assert.deepStrictEqual(persisted?.cachedBalances, priorBalances)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('produces api_unavailable when balance refresh encounters server 5xx error', async () => {
    const priorBalances = [{ memberId: 'm-1', name: 'Julian', outstandingCents: 5000 }]
    const session: StoredHomeSession = {
      version: 1,
      home: { id: 'h-100', name: 'Waverly' },
      members: [{ id: 'm-1', homeId: 'h-100', name: 'Julian' }],
      bills: [],
      cachedBalances: priorBalances,
      updatedAt: '2026-11-06T00:00:00Z',
    }

    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
      [getHomeStorageKey('h-100')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/members')) {
          return new Response(JSON.stringify({ id: 'm-2', homeId: 'h-100', name: 'Elena' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (urlStr.includes('/balances')) {
          return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error('Unexpected URL')
      }

      const client = new ApiClient()
      const result = await addHouseholdMember(client, session, 'Elena', storage)
      assert.strictEqual(result.status, 'api_unavailable')
      if (result.status === 'api_unavailable') {
        assert.strictEqual(result.session.members.length, 2)
        assert.deepStrictEqual(result.session.cachedBalances, priorBalances)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('produces stale and does NOT label offline when balance refresh encounters client HTTP error or malformed 2xx', async () => {
    const priorBalances = [{ memberId: 'm-1', name: 'Julian', outstandingCents: 5000 }]
    const session: StoredHomeSession = {
      version: 1,
      home: { id: 'h-100', name: 'Waverly' },
      members: [{ id: 'm-1', homeId: 'h-100', name: 'Julian' }],
      bills: [],
      cachedBalances: priorBalances,
      updatedAt: '2026-11-06T00:00:00Z',
    }

    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
      [getHomeStorageKey('h-100')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/members')) {
          return new Response(JSON.stringify({ id: 'm-2', homeId: 'h-100', name: 'Elena' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (urlStr.includes('/balances')) {
          // Returns 400 Bad Request or malformed format
          return new Response(JSON.stringify({ error: 'Bad Request' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error('Unexpected URL')
      }

      const client = new ApiClient()
      const result = await addHouseholdMember(client, session, 'Elena', storage)

      // Must produce 'stale', NOT 'api_unavailable'
      assert.strictEqual(result.status, 'stale')
      if (result.status === 'stale') {
        assert.strictEqual(result.member.name, 'Elena')
        // Preserves newly created member and cached balances
        assert.strictEqual(result.session.members.length, 2)
        assert.deepStrictEqual(result.session.cachedBalances, priorBalances)
      }

      // Persisted in storage
      const persisted = loadHomeSession('h-100', storage)
      assert.strictEqual(persisted?.members.length, 2)
      assert.deepStrictEqual(persisted?.cachedBalances, priorBalances)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('clears storage and returns invalid_home if getBalances returns 404 after member creation', async () => {
    const session = initializeHomeSession({ id: 'h-100', name: 'Waverly' })
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
      [getHomeStorageKey('h-100')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/members')) {
          return new Response(JSON.stringify({ id: 'm-2', homeId: 'h-100', name: 'Elena' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (urlStr.includes('/balances')) {
          return new Response(JSON.stringify({ error: 'Home not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error('Unexpected URL')
      }

      const client = new ApiClient()
      const result = await addHouseholdMember(client, session, 'Elena', storage)
      assert.strictEqual(result.status, 'invalid_home')

      // Must clean up storage
      assert.strictEqual(loadActiveHomeId(storage), null)
      assert.strictEqual(loadHomeSession('h-100', storage), null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('clears storage and returns invalid_home if createMember itself returns 404', async () => {
    const session = initializeHomeSession({ id: 'h-100', name: 'Waverly' })
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
      [getHomeStorageKey('h-100')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: 'Home not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })

      const client = new ApiClient()
      const result = await addHouseholdMember(client, session, 'Elena', storage)
      assert.strictEqual(result.status, 'invalid_home')

      // Storage cleaned up
      assert.strictEqual(loadActiveHomeId(storage), null)
      assert.strictEqual(loadHomeSession('h-100', storage), null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('retains updated session in memory and sets persistenceWarning when saving fails after successful member creation', async () => {
    const session = initializeHomeSession({ id: 'h-persist', name: 'Memory Loft' })
    const failingStorage: Storage = {
      ...createMockStorage(),
      setItem() {
        throw new DOMException('Storage full', 'QuotaExceededError')
      },
    }

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/members')) {
          return new Response(JSON.stringify({ id: 'm-new', homeId: 'h-persist', name: 'Elena' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (urlStr.includes('/balances')) {
          return new Response(
            JSON.stringify({
              balances: [{ memberId: 'm-new', name: 'Elena', outstandingCents: 0 }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        throw new Error('Unexpected URL')
      }

      const client = new ApiClient()
      const result = await addHouseholdMember(client, session, 'Elena', failingStorage)

      assert.strictEqual(result.status, 'success')
      if (result.status === 'success') {
        assert.strictEqual(result.session.members.length, 1)
        assert.strictEqual(result.session.members[0]?.name, 'Elena')
        assert.match(result.persistenceWarning ?? '', /local storage could not save/i)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('retains updated session in memory and sets persistenceWarning when saving fails on offline refresh', async () => {
    const session = initializeHomeSession({ id: 'h-persist-offline', name: 'Memory Loft' })
    const failingStorage: Storage = {
      ...createMockStorage(),
      setItem() {
        throw new DOMException('Storage full', 'QuotaExceededError')
      },
    }

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/members')) {
          return new Response(
            JSON.stringify({ id: 'm-new', homeId: 'h-persist-offline', name: 'Elena' }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (urlStr.includes('/balances')) {
          throw new TypeError('Failed to fetch')
        }
        throw new Error('Unexpected URL')
      }

      const client = new ApiClient()
      const result = await addHouseholdMember(client, session, 'Elena', failingStorage)

      assert.strictEqual(result.status, 'api_unavailable')
      if (result.status === 'api_unavailable') {
        assert.strictEqual(result.session.members.length, 1)
        assert.strictEqual(result.session.members[0]?.name, 'Elena')
        assert.match(result.persistenceWarning ?? '', /local storage could not save/i)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('retains updated session in memory and sets persistenceWarning when saving fails on stale refresh', async () => {
    const session = initializeHomeSession({ id: 'h-persist-stale', name: 'Memory Loft' })
    const failingStorage: Storage = {
      ...createMockStorage(),
      setItem() {
        throw new DOMException('Storage full', 'QuotaExceededError')
      },
    }

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/members')) {
          return new Response(
            JSON.stringify({ id: 'm-new', homeId: 'h-persist-stale', name: 'Elena' }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (urlStr.includes('/balances')) {
          return new Response(JSON.stringify({ error: 'Unprocessable' }), {
            status: 422,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error('Unexpected URL')
      }

      const client = new ApiClient()
      const result = await addHouseholdMember(client, session, 'Elena', failingStorage)

      assert.strictEqual(result.status, 'stale')
      if (result.status === 'stale') {
        assert.strictEqual(result.session.members.length, 1)
        assert.strictEqual(result.session.members[0]?.name, 'Elena')
        assert.match(result.persistenceWarning ?? '', /local storage could not save/i)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not identify a newly created member by name alone when an existing resident shares the same name', async () => {
    // Baseline roster already has a resident 'Julian' with ID 'm-1'
    const session: StoredHomeSession = {
      version: 1,
      home: { id: 'h-same-name', name: 'Name Test Home' },
      members: [{ id: 'm-1', homeId: 'h-same-name', name: 'Julian' }],
      bills: [],
      cachedBalances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 5000 }],
      updatedAt: '2026-11-06T00:00:00Z',
    }
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-same-name',
      [getHomeStorageKey('h-same-name')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/members')) {
          throw new TypeError('Network timeout')
        }
        if (urlStr.includes('/balances')) {
          // Server balances only return the pre-existing Julian (m-1)
          return new Response(
            JSON.stringify({
              balances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 5000 }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        throw new Error('Unexpected URL')
      }

      const client = new ApiClient()
      const result = await addHouseholdMember(client, session, 'Julian', storage)

      // Must NOT identify pre-existing m-1 as the new member! Keeps outcome uncertain
      assert.strictEqual(result.status, 'uncertain')
      if (result.status === 'uncertain') {
        assert.strictEqual(result.pendingMember.name, 'Julian')
        assert.deepStrictEqual(result.pendingMember.baselineMemberIds, ['m-1'])
        // Must NOT tell user it is safe to retry
        assert.doesNotMatch(result.error, /safe to retry/i)
        assert.match(result.error, /do not retry immediately/i)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('treats a single newly observed member with the same name but a different ID as reconciled success', async () => {
    // Baseline roster already has Julian (m-1)
    const session: StoredHomeSession = {
      version: 1,
      home: { id: 'h-diff-id', name: 'Diff ID Home' },
      members: [{ id: 'm-1', homeId: 'h-diff-id', name: 'Julian' }],
      bills: [],
      cachedBalances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 5000 }],
      updatedAt: '2026-11-06T00:00:00Z',
    }
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-diff-id',
      [getHomeStorageKey('h-diff-id')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/members')) {
          throw new TypeError('Network failure')
        }
        if (urlStr.includes('/balances')) {
          // Server returns pre-existing m-1 AND newly created m-2, both named Julian
          return new Response(
            JSON.stringify({
              balances: [
                { memberId: 'm-1', name: 'Julian', outstandingCents: 5000 },
                { memberId: 'm-2', name: 'Julian', outstandingCents: 0 },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        throw new Error('Unexpected URL')
      }

      const client = new ApiClient()
      const result = await addHouseholdMember(client, session, 'Julian', storage)

      assert.strictEqual(result.status, 'success')
      if (result.status === 'success') {
        // Correctly identifies m-2 as the newly created member by contrasting with baseline IDs
        assert.strictEqual(result.member.id, 'm-2')
        assert.strictEqual(result.member.name, 'Julian')
        assert.strictEqual(result.session.members.length, 2)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('preserves pending member and baseline IDs when balances check is unreachable during POST network failure', async () => {
    const session = initializeHomeSession({ id: 'h-unreachable', name: 'Unreachable House' })
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-unreachable',
      [getHomeStorageKey('h-unreachable')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () => {
        throw new TypeError('Total network outage')
      }

      const client = new ApiClient()
      const result = await addHouseholdMember(client, session, 'Elena', storage)
      assert.strictEqual(result.status, 'uncertain')
      if (result.status === 'uncertain') {
        assert.strictEqual(result.pendingMember.name, 'Elena')
        assert.deepStrictEqual(result.pendingMember.baselineMemberIds, [])
        assert.match(result.error, /cannot yet be confirmed/i)
        assert.doesNotMatch(result.error, /safe to retry/i)
        assert.match(result.error, /do not retry immediately/i)
        assert.match(result.error, /reconcile with server/i)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('reconcileHouseholdRoster Workflow', () => {
  it('successfully reconciles roster and balances from authoritative server endpoint', async () => {
    const session = initializeHomeSession({ id: 'h-reconcile', name: 'Reconcile Flat' })
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-reconcile',
      [getHomeStorageKey('h-reconcile')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            balances: [
              { memberId: 'm-1', name: 'Julian', outstandingCents: 5000 },
              { memberId: 'm-2', name: 'Elena', outstandingCents: 0 },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )

      const client = new ApiClient()
      const result = await reconcileHouseholdRoster(client, session, null, storage)
      assert.strictEqual(result.status, 'ready')
      if (result.status === 'ready') {
        assert.strictEqual(result.session.members.length, 2)
        assert.strictEqual(result.session.members[0]?.name, 'Julian')
        assert.strictEqual(result.session.members[1]?.name, 'Elena')
        assert.strictEqual(result.persistenceWarning, undefined)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not clear uncertain warning when a successful balances refresh does not resolve the pending member', async () => {
    const session: StoredHomeSession = {
      version: 1,
      home: { id: 'h-unresolved', name: 'Unresolved Home' },
      members: [{ id: 'm-1', homeId: 'h-unresolved', name: 'Julian' }],
      bills: [],
      cachedBalances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 5000 }],
      updatedAt: '2026-11-06T00:00:00Z',
    }
    const pendingMember = { name: 'Elena', baselineMemberIds: ['m-1'] }

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            balances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 5000 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )

      const client = new ApiClient()
      const result = await reconcileHouseholdRoster(client, session, pendingMember)

      // Server returned 200 OK, but Elena has not appeared: resolvedPending must be false
      assert.strictEqual(result.status, 'ready')
      if (result.status === 'ready') {
        assert.strictEqual(result.resolvedPending, false)
        assert.strictEqual(result.pendingMember?.name, 'Elena')
        assert.match(result.error ?? '', /outcome remains uncertain/i)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('clears storage and returns invalid_home on 404 during uncertain-outcome reconciliation', async () => {
    const session = initializeHomeSession({ id: 'h-reconcile-404', name: 'Reconcile 404' })
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-reconcile-404',
      [getHomeStorageKey('h-reconcile-404')]: JSON.stringify(session),
    })
    const pendingMember = { name: 'Elena', baselineMemberIds: [] }

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: 'Household not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })

      const client = new ApiClient()
      const result = await reconcileHouseholdRoster(client, session, pendingMember, storage)

      assert.strictEqual(result.status, 'invalid_home')
      assert.strictEqual(loadActiveHomeId(storage), null)
      assert.strictEqual(loadHomeSession('h-reconcile-404', storage), null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns persistenceWarning when storage setItem fails during reconciliation', async () => {
    const session = initializeHomeSession({ id: 'h-reconcile', name: 'Reconcile Flat' })
    const failingStorage: Storage = {
      ...createMockStorage(),
      setItem() {
        throw new DOMException('Disk quota exceeded', 'QuotaExceededError')
      },
    }

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            balances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 0 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )

      const client = new ApiClient()
      const result = await reconcileHouseholdRoster(client, session, null, failingStorage)
      assert.strictEqual(result.status, 'ready')
      if (result.status === 'ready') {
        assert.match(result.persistenceWarning ?? '', /local storage could not save/i)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('clears storage and returns invalid_home on server 404', async () => {
    const session = initializeHomeSession({ id: 'h-gone', name: 'Gone House' })
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-gone',
      [getHomeStorageKey('h-gone')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })

      const client = new ApiClient()
      const result = await reconcileHouseholdRoster(client, session, null, storage)
      assert.strictEqual(result.status, 'invalid_home')
      assert.strictEqual(loadActiveHomeId(storage), null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('persists uncertain member creation across browser reloads and allows subsequent reconciliation', async () => {
    // 1. Initial active session with baseline member Julian
    const initialSession = initializeHomeSession({ id: 'h-reload', name: 'Reload Loft' })
    initialSession.members = [{ id: 'm-1', homeId: 'h-reload', name: 'Julian' }]
    initialSession.cachedBalances = [{ memberId: 'm-1', name: 'Julian', outstandingCents: 0 }]

    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-reload',
      [getHomeStorageKey('h-reload')]: JSON.stringify(initialSession),
    })

    const originalFetch = globalThis.fetch
    try {
      // 2. Simulate uncertain member creation: POST /members drops connection, GET balances fails
      globalThis.fetch = async () => {
        throw new TypeError('Network timeout during member creation')
      }

      const client = new ApiClient()
      const uncertainResult = await addHouseholdMember(client, initialSession, 'Elena', storage)

      assert.strictEqual(uncertainResult.status, 'uncertain')
      if (uncertainResult.status === 'uncertain') {
        assert.strictEqual(uncertainResult.pendingMember.name, 'Elena')
        assert.deepStrictEqual(uncertainResult.pendingMember.baselineMemberIds, ['m-1'])
        assert.match(uncertainResult.error, /cannot yet be confirmed/i)
        assert.doesNotMatch(uncertainResult.error, /safe to retry/i)
      }

      // Verify the session in storage has pendingMemberCreation saved
      const savedSession = loadHomeSession('h-reload', storage)
      assert.notStrictEqual(savedSession, null)
      assert.strictEqual(savedSession?.pendingMemberCreation?.name, 'Elena')
      assert.deepStrictEqual(savedSession?.pendingMemberCreation?.baselineMemberIds, ['m-1'])

      // 3. Simulate browser reload: call restoreHouseholdSession from the same storage
      // Server is back online with balances, but Elena has not appeared yet
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            balances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 0 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )

      const reloadResult = await restoreHouseholdSession(client, storage)
      assert.strictEqual(reloadResult.status, 'ready')
      assert.ok(reloadResult.session)
      // Pending member and baseline IDs are recovered after page reload!
      assert.strictEqual(reloadResult.session.pendingMemberCreation?.name, 'Elena')
      assert.deepStrictEqual(reloadResult.session.pendingMemberCreation?.baselineMemberIds, ['m-1'])

      // 4. Verify reconciliation remains available and does not encourage a duplicate submission
      const reconcileAttempt1 = await reconcileHouseholdRoster(
        client,
        reloadResult.session,
        reloadResult.session.pendingMemberCreation,
        storage,
      )
      assert.strictEqual(reconcileAttempt1.status, 'ready')
      if (reconcileAttempt1.status === 'ready') {
        // Elena still hasn't appeared: outcome remains uncertain
        assert.strictEqual(reconcileAttempt1.resolvedPending, false)
        assert.match(reconcileAttempt1.error ?? '', /outcome remains uncertain/i)
        assert.doesNotMatch(reconcileAttempt1.error ?? '', /safe to retry/i)
      }

      // 5. Subsequent reconciliation when server finally returns Elena (m-2)
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            balances: [
              { memberId: 'm-1', name: 'Julian', outstandingCents: 0 },
              { memberId: 'm-2', name: 'Elena', outstandingCents: 0 },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )

      const reconcileAttempt2 = await reconcileHouseholdRoster(
        client,
        reconcileAttempt1.session,
        reconcileAttempt1.pendingMember,
        storage,
      )
      assert.strictEqual(reconcileAttempt2.status, 'ready')
      if (reconcileAttempt2.status === 'ready') {
        assert.strictEqual(reconcileAttempt2.resolvedPending, true)
        assert.strictEqual(reconcileAttempt2.reconciledMember?.id, 'm-2')
        assert.strictEqual(reconcileAttempt2.reconciledMember?.name, 'Elena')
        assert.strictEqual(reconcileAttempt2.session.pendingMemberCreation, null)
      }

      // Cleared from stored session after resolution
      const finalSavedSession = loadHomeSession('h-reload', storage)
      assert.strictEqual(finalSavedSession?.pendingMemberCreation, null)
      assert.strictEqual(finalSavedSession?.members.length, 2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('addHouseholdBill Workflow & History Persistence', () => {
  it('saves successfully created bill into session.bills and persists to storage', async () => {
    const session: StoredHomeSession = {
      version: 1,
      home: { id: 'h-bills', name: 'Bill Test House' },
      members: [{ id: 'm-1', homeId: 'h-bills', name: 'Julian' }],
      bills: [],
      cachedBalances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 0 }],
      pendingMemberCreation: null,
      updatedAt: new Date().toISOString(),
    }
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-bills',
      [getHomeStorageKey('h-bills')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (input, init) => {
        const url = String(input)
        if (init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 'b-101',
              homeId: 'h-bills',
              title: 'Whole Foods Market',
              totalCents: 6000,
              shares: [{ id: 's-101', memberId: 'm-1', amountCents: 6000, paidAt: null }],
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('/balances')) {
          return new Response(
            JSON.stringify({
              balances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 6000 }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('Not found', { status: 404 })
      }

      const client = new ApiClient()
      const result = await addHouseholdBill(client, session, 'Whole Foods Market', 6000, storage)

      assert.strictEqual(result.status, 'success')
      assert.ok(result.session)
      assert.strictEqual(result.session.bills.length, 1)
      assert.strictEqual(result.session.bills[0]?.id, 'b-101')
      assert.strictEqual(result.session.bills[0]?.title, 'Whole Foods Market')
      assert.strictEqual(result.session.bills[0]?.totalCents, 6000)
      assert.strictEqual(typeof result.session.bills[0]?.clientCreatedAt, 'string')
      assert.strictEqual(result.session.bills[0]?.shares.length, 1)
      assert.strictEqual(result.session.bills[0]?.shares[0]?.paidAt, null)

      // Balances refreshed
      assert.strictEqual(result.session.cachedBalances?.[0]?.outstandingCents, 6000)

      // Persisted to storage
      const savedSession = loadHomeSession('h-bills', storage)
      assert.notStrictEqual(savedSession, null)
      assert.strictEqual(savedSession?.bills.length, 1)
      assert.strictEqual(savedSession?.bills[0]?.title, 'Whole Foods Market')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('preserves bill history across browser reload via restoreHouseholdSession', async () => {
    const sessionWithBills: StoredHomeSession = {
      version: 1,
      home: { id: 'h-reload-bills', name: 'History House' },
      members: [
        { id: 'm-1', homeId: 'h-reload-bills', name: 'Julian' },
        { id: 'm-2', homeId: 'h-reload-bills', name: 'Elena' },
      ],
      bills: [
        {
          id: 'b-past',
          homeId: 'h-reload-bills',
          title: 'Con Edison Electricity',
          totalCents: 12000,
          clientCreatedAt: '2026-11-01T10:00:00Z',
          shares: [
            { id: 's-1', memberId: 'm-1', amountCents: 6000, paidAt: '2026-11-02T10:00:00Z' },
            { id: 's-2', memberId: 'm-2', amountCents: 6000, paidAt: null },
          ],
        },
      ],
      cachedBalances: [
        { memberId: 'm-1', name: 'Julian', outstandingCents: 0 },
        { memberId: 'm-2', name: 'Elena', outstandingCents: 6000 },
      ],
      pendingMemberCreation: null,
      updatedAt: '2026-11-02T10:00:00Z',
    }

    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-reload-bills',
      [getHomeStorageKey('h-reload-bills')]: JSON.stringify(sessionWithBills),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            balances: [
              { memberId: 'm-1', name: 'Julian', outstandingCents: 0 },
              { memberId: 'm-2', name: 'Elena', outstandingCents: 6000 },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )

      const client = new ApiClient()
      const reloadResult = await restoreHouseholdSession(client, storage)

      assert.strictEqual(reloadResult.status, 'ready')
      assert.ok(reloadResult.session)
      // Bill history successfully preserved across reload!
      assert.strictEqual(reloadResult.session.bills.length, 1)
      assert.strictEqual(reloadResult.session.bills[0]?.title, 'Con Edison Electricity')
      assert.strictEqual(reloadResult.session.bills[0]?.totalCents, 12000)
      assert.strictEqual(reloadResult.session.bills[0]?.shares.length, 2)
      assert.strictEqual(reloadResult.session.bills[0]?.shares[0]?.paidAt, '2026-11-02T10:00:00Z')
      assert.strictEqual(reloadResult.session.bills[0]?.shares[1]?.paidAt, null)

      // Storage preserved with bill history
      const savedInStorage = loadHomeSession('h-reload-bills', storage)
      assert.strictEqual(savedInStorage?.bills.length, 1)
      assert.strictEqual(savedInStorage?.bills[0]?.title, 'Con Edison Electricity')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('retains bill in memory and surfaces persistenceWarning when localStorage fails', async () => {
    const session: StoredHomeSession = {
      version: 1,
      home: { id: 'h-failing', name: 'Failing Storage Home' },
      members: [{ id: 'm-1', homeId: 'h-failing', name: 'Julian' }],
      bills: [],
      cachedBalances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 0 }],
      pendingMemberCreation: null,
      updatedAt: new Date().toISOString(),
    }

    const failingStorage: Storage = {
      get length() {
        return 1
      },
      clear() {},
      getItem(key: string) {
        if (key === ACTIVE_HOME_STORAGE_KEY) return 'h-failing'
        if (key === getHomeStorageKey('h-failing')) return JSON.stringify(session)
        return null
      },
      key() {
        return null
      },
      removeItem() {},
      setItem() {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError')
      },
    }

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (_input, init) => {
        if (init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 'b-mem-only',
              homeId: 'h-failing',
              title: 'Internet Service',
              totalCents: 5000,
              shares: [{ id: 's-1', memberId: 'm-1', amountCents: 5000, paidAt: null }],
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify({
            balances: [{ memberId: 'm-1', name: 'Julian', outstandingCents: 5000 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      const client = new ApiClient()
      const result = await addHouseholdBill(
        client,
        session,
        'Internet Service',
        5000,
        failingStorage,
      )

      assert.strictEqual(result.status, 'success')
      assert.ok(result.session)
      // Bill is preserved in memory despite storage failure!
      assert.strictEqual(result.session.bills.length, 1)
      assert.strictEqual(result.session.bills[0]?.title, 'Internet Service')
      // Observable persistence warning is surfaced
      assert.ok(result.persistenceWarning)
      assert.match(result.persistenceWarning ?? '', /local storage could not save/i)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns invalid_home and cleans storage when server returns 404 on createBill', async () => {
    const session: StoredHomeSession = {
      version: 1,
      home: { id: 'h-deleted', name: 'Deleted House' },
      members: [{ id: 'm-1', homeId: 'h-deleted', name: 'Julian' }],
      bills: [],
      cachedBalances: [],
      pendingMemberCreation: null,
      updatedAt: new Date().toISOString(),
    }
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-deleted',
      [getHomeStorageKey('h-deleted')]: JSON.stringify(session),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: 'Home not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })

      const client = new ApiClient()
      const result = await addHouseholdBill(client, session, 'Ghost Expense', 3000, storage)

      assert.strictEqual(result.status, 'invalid_home')
      assert.strictEqual(loadActiveHomeId(storage), null)
      assert.strictEqual(loadHomeSession('h-deleted', storage), null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('payHouseholdShare Workflow & Idempotency', () => {
  const baseSession: StoredHomeSession = {
    version: 1,
    home: { id: 'h-100', name: 'Pinecrest Manor' },
    members: [
      { id: 'm-1', homeId: 'h-100', name: 'Julian' },
      { id: 'm-2', homeId: 'h-100', name: 'Avery' },
    ],
    bills: [
      {
        id: 'b-1',
        homeId: 'h-100',
        title: 'Water Utility',
        totalCents: 5000,
        clientCreatedAt: '2026-11-06T10:00:00Z',
        shares: [
          { id: 's-1', memberId: 'm-1', amountCents: 2500, paidAt: null },
          { id: 's-2', memberId: 'm-2', amountCents: 2500, paidAt: null },
        ],
      },
    ],
    cachedBalances: [
      { memberId: 'm-1', name: 'Julian', outstandingCents: 2500 },
      { memberId: 'm-2', name: 'Avery', outstandingCents: 2500 },
    ],
    pendingMemberCreation: null,
    updatedAt: '2026-11-06T10:00:00Z',
  }

  it('processes successful payment, clears idempotency key, refreshes balances, and persists history', async () => {
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
      [getHomeStorageKey('h-100')]: JSON.stringify(baseSession),
    })

    const originalFetch = globalThis.fetch
    try {
      let sentIdempotencyKey: string | undefined
      globalThis.fetch = async (input, init) => {
        const url = String(input)
        if (url.includes('/api/bills/b-1/shares/s-1/pay')) {
          sentIdempotencyKey = (init?.headers as Record<string, string> | undefined)?.[
            'Idempotency-Key'
          ]
          assert.ok(sentIdempotencyKey, 'Idempotency-Key header must be sent')
          const res: PayShareResponse = {
            id: 's-1',
            memberId: 'm-1',
            amountCents: 2500,
            paidAt: '2026-11-06T12:00:00Z',
          }
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/api/homes/h-100/balances')) {
          const res: BalancesResponse = {
            balances: [
              { memberId: 'm-1', name: 'Julian', outstandingCents: 0 },
              { memberId: 'm-2', name: 'Avery', outstandingCents: 2500 },
            ],
          }
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error(`Unexpected fetch URL: ${url}`)
      }

      const client = new ApiClient()
      const result = await payHouseholdShare(client, baseSession, 'b-1', 's-1', storage)

      assert.strictEqual(result.status, 'success')
      assert.ok(result.share)
      assert.strictEqual(result.share.paidAt, '2026-11-06T12:00:00Z')
      assert.strictEqual(result.share.pendingIdempotencyKey, null)

      assert.ok(result.session)
      const targetShare = result.session.bills[0]?.shares.find((s) => s.id === 's-1')
      assert.strictEqual(targetShare?.paidAt, '2026-11-06T12:00:00Z')
      assert.strictEqual(targetShare?.pendingIdempotencyKey, null)

      // Authoritative balances refreshed
      const julianBalance = result.session.cachedBalances?.find((b) => b.memberId === 'm-1')
      assert.strictEqual(julianBalance?.outstandingCents, 0)

      // Storage updated
      const persisted = loadHomeSession('h-100', storage)
      assert.ok(persisted)
      assert.strictEqual(persisted.bills[0]?.shares[0]?.paidAt, '2026-11-06T12:00:00Z')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('network failure keeps share unpaid and preserves idempotency key, then retry succeeds using the exact same key', async () => {
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
      [getHomeStorageKey('h-100')]: JSON.stringify(baseSession),
    })

    const originalFetch = globalThis.fetch
    try {
      let attempts = 0
      const capturedKeys: string[] = []

      globalThis.fetch = async (input, init) => {
        const url = String(input)
        if (url.includes('/pay')) {
          attempts++
          const key = (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key']
          if (key) capturedKeys.push(key)

          if (attempts === 1) {
            // Simulate network offline drop
            throw new TypeError('Failed to fetch')
          }

          const res: PayShareResponse = {
            id: 's-1',
            memberId: 'm-1',
            amountCents: 2500,
            paidAt: '2026-11-06T12:30:00Z',
          }
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (url.includes('/balances')) {
          const res: BalancesResponse = {
            balances: [
              { memberId: 'm-1', name: 'Julian', outstandingCents: 0 },
              { memberId: 'm-2', name: 'Avery', outstandingCents: 2500 },
            ],
          }
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        throw new Error(`Unexpected URL: ${url}`)
      }

      const client = new ApiClient()

      // First attempt: fails with network error
      const result1 = await payHouseholdShare(client, baseSession, 'b-1', 's-1', storage)
      assert.strictEqual(result1.status, 'api_unavailable')
      assert.ok(result1.session)
      const share1 = result1.session.bills[0]?.shares.find((s) => s.id === 's-1')
      assert.strictEqual(share1?.paidAt, null) // Must remain visually unpaid!
      assert.ok(share1?.pendingIdempotencyKey)
      assert.strictEqual(capturedKeys.length, 1)
      assert.strictEqual(share1.pendingIdempotencyKey, capturedKeys[0])

      // Storage persisted the key before network failure
      const persistedAfterFail = loadHomeSession('h-100', storage)
      assert.strictEqual(
        persistedAfterFail?.bills[0]?.shares[0]?.pendingIdempotencyKey,
        capturedKeys[0],
      )

      // Second attempt (retry): must send EXACT SAME idempotency key
      const result2 = await payHouseholdShare(client, result1.session, 'b-1', 's-1', storage)
      assert.strictEqual(result2.status, 'success')
      assert.strictEqual(capturedKeys.length, 2)
      assert.strictEqual(
        capturedKeys[0],
        capturedKeys[1],
        'Must reuse exact same idempotency key on retry',
      )

      const share2 = result2.session?.bills[0]?.shares.find((s) => s.id === 's-1')
      assert.strictEqual(share2?.paidAt, '2026-11-06T12:30:00Z')
      assert.strictEqual(share2?.pendingIdempotencyKey, null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('500 server error preserves idempotency key and allows retry with the same key', async () => {
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
      [getHomeStorageKey('h-100')]: JSON.stringify(baseSession),
    })

    const originalFetch = globalThis.fetch
    try {
      let attempts = 0
      const capturedKeys: string[] = []

      globalThis.fetch = async (input, init) => {
        const url = String(input)
        if (url.includes('/pay')) {
          attempts++
          const key = (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key']
          if (key) capturedKeys.push(key)

          if (attempts === 1) {
            return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          const res: PayShareResponse = {
            id: 's-1',
            memberId: 'm-1',
            amountCents: 2500,
            paidAt: '2026-11-06T13:00:00Z',
          }
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (url.includes('/balances')) {
          const res: BalancesResponse = {
            balances: [
              { memberId: 'm-1', name: 'Julian', outstandingCents: 0 },
              { memberId: 'm-2', name: 'Avery', outstandingCents: 2500 },
            ],
          }
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        throw new Error(`Unexpected URL: ${url}`)
      }

      const client = new ApiClient()

      // Attempt 1: 500 error
      const result1 = await payHouseholdShare(client, baseSession, 'b-1', 's-1', storage)
      assert.strictEqual(result1.status, 'api_unavailable')
      assert.ok(result1.session)
      const share1 = result1.session.bills[0]?.shares.find((s) => s.id === 's-1')
      assert.strictEqual(share1?.paidAt, null) // Visually unpaid
      assert.ok(share1?.pendingIdempotencyKey)

      // Attempt 2: retry succeeds with the same key
      const result2 = await payHouseholdShare(client, result1.session, 'b-1', 's-1', storage)
      assert.strictEqual(result2.status, 'success')
      assert.strictEqual(capturedKeys.length, 2)
      assert.strictEqual(capturedKeys[0], capturedKeys[1], 'Must reuse idempotency key after 500')
      assert.strictEqual(result2.session?.bills[0]?.shares[0]?.paidAt, '2026-11-06T13:00:00Z')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('409 conflict keeps share visually unpaid and reports conflict without inventing a paid state', async () => {
    const storage = createMockStorage({
      [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
      [getHomeStorageKey('h-100')]: JSON.stringify(baseSession),
    })

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (input) => {
        const url = String(input)
        if (url.includes('/pay')) {
          return new Response(JSON.stringify({ error: 'Share has already been paid' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error(`Unexpected URL: ${url}`)
      }

      const client = new ApiClient()
      const result = await payHouseholdShare(client, baseSession, 'b-1', 's-1', storage)

      assert.strictEqual(result.status, 'conflict')
      assert.ok(result.error)
      assert.match(result.error, /conflict/i)

      // Share must NEVER be marked as paid
      assert.ok(result.session)
      const share = result.session.bills[0]?.shares.find((s) => s.id === 's-1')
      assert.strictEqual(share?.paidAt, null, 'Conflict must never invent a paid state')

      // Storage also must not show paid
      const persisted = loadHomeSession('h-100', storage)
      assert.strictEqual(persisted?.bills[0]?.shares[0]?.paidAt, null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('aborts payment request without sending fetch if pre-persistence of idempotency key fails', async () => {
    let fetchCalled = false
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () => {
        fetchCalled = true
        return new Response('{}', { status: 200 })
      }

      const failingStorage = createMockStorage()
      failingStorage.setItem = () => {
        throw new Error('Storage write quota exceeded')
      }

      const client = new ApiClient()
      const result = await payHouseholdShare(client, baseSession, 'b-1', 's-1', failingStorage)

      assert.strictEqual(result.status, 'storage_error')
      assert.strictEqual(
        fetchCalled,
        false,
        'HTTP payment request must NEVER be sent if storage write fails',
      )
      assert.ok(result.persistenceWarning)
      assert.match(result.persistenceWarning, /write failed/i)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('retains updated paid share in memory with persistence warning if post-payment persistence fails', async () => {
    let writeCount = 0
    const mockStore = new Map<string, string>([
      [ACTIVE_HOME_STORAGE_KEY, 'h-100'],
      [getHomeStorageKey('h-100'), JSON.stringify(baseSession)],
    ])

    const partialStorage: Storage = {
      get length() {
        return mockStore.size
      },
      clear() {
        mockStore.clear()
      },
      getItem(key: string) {
        return mockStore.get(key) ?? null
      },
      key(index: number) {
        return Array.from(mockStore.keys())[index] ?? null
      },
      removeItem(key: string) {
        mockStore.delete(key)
      },
      setItem(key: string, value: string) {
        writeCount++
        if (writeCount > 1) {
          // Fail on the post-payment write!
          throw new Error('Disk write failed post-payment')
        }
        mockStore.set(key, String(value))
      },
    }

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (input) => {
        const url = String(input)
        if (url.includes('/pay')) {
          const res: PayShareResponse = {
            id: 's-1',
            memberId: 'm-1',
            amountCents: 2500,
            paidAt: '2026-11-06T14:00:00Z',
          }
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/balances')) {
          const res: BalancesResponse = {
            balances: [
              { memberId: 'm-1', name: 'Julian', outstandingCents: 0 },
              { memberId: 'm-2', name: 'Avery', outstandingCents: 2500 },
            ],
          }
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error(`Unexpected URL: ${url}`)
      }

      const client = new ApiClient()
      const result = await payHouseholdShare(client, baseSession, 'b-1', 's-1', partialStorage)

      assert.strictEqual(result.status, 'success')
      assert.ok(result.session)
      assert.strictEqual(result.session.bills[0]?.shares[0]?.paidAt, '2026-11-06T14:00:00Z')
      assert.strictEqual(result.session.bills[0]?.shares[0]?.pendingIdempotencyKey, null)
      assert.ok(result.persistenceWarning)
      assert.match(result.persistenceWarning, /local storage could not save/i)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('guarantees failed payments are never rendered as paid across network, 500, 409, and storage failures', async () => {
    const client = new ApiClient()
    const originalFetch = globalThis.fetch

    try {
      // 1. Network failure
      globalThis.fetch = async () => {
        throw new TypeError('Network connection lost')
      }
      const storage1 = createMockStorage({
        [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
        [getHomeStorageKey('h-100')]: JSON.stringify(baseSession),
      })
      const netResult = await payHouseholdShare(client, baseSession, 'b-1', 's-1', storage1)
      assert.strictEqual(
        'session' in netResult && netResult.session
          ? netResult.session.bills[0]?.shares[0]?.paidAt
          : null,
        null,
      )

      // 2. 500 Internal Server Error
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: 'Crash' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      const storage2 = createMockStorage({
        [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
        [getHomeStorageKey('h-100')]: JSON.stringify(baseSession),
      })
      const s500Result = await payHouseholdShare(client, baseSession, 'b-1', 's-1', storage2)
      assert.strictEqual(
        'session' in s500Result && s500Result.session
          ? s500Result.session.bills[0]?.shares[0]?.paidAt
          : null,
        null,
      )

      // 3. 504 Gateway Timeout
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: 'Gateway timeout' }), {
          status: 504,
          headers: { 'Content-Type': 'application/json' },
        })
      const storage3 = createMockStorage({
        [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
        [getHomeStorageKey('h-100')]: JSON.stringify(baseSession),
      })
      const s504Result = await payHouseholdShare(client, baseSession, 'b-1', 's-1', storage3)
      assert.strictEqual(
        'session' in s504Result && s504Result.session
          ? s504Result.session.bills[0]?.shares[0]?.paidAt
          : null,
        null,
      )

      // 4. 409 Conflict
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: 'Conflict' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      const storage4 = createMockStorage({
        [ACTIVE_HOME_STORAGE_KEY]: 'h-100',
        [getHomeStorageKey('h-100')]: JSON.stringify(baseSession),
      })
      const s409Result = await payHouseholdShare(client, baseSession, 'b-1', 's-1', storage4)
      assert.strictEqual(
        'session' in s409Result && s409Result.session
          ? s409Result.session.bills[0]?.shares[0]?.paidAt
          : null,
        null,
      )

      // 5. Pre-request storage error
      const storage5 = createMockStorage()
      storage5.setItem = () => {
        throw new Error('Quota error')
      }
      const storageErrResult = await payHouseholdShare(client, baseSession, 'b-1', 's-1', storage5)
      assert.strictEqual(
        'session' in storageErrResult && storageErrResult.session
          ? storageErrResult.session.bills[0]?.shares[0]?.paidAt
          : null,
        null,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
