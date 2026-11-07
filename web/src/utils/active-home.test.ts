import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clearActiveHomeId, loadActiveHomeId, saveActiveHomeId } from './active-home.ts'

const ACTIVE_HOME_KEY = 'bill_splitter_active_home'

function withMockLocalStorage(overrides: Partial<Storage> = {}, fn: () => void): void {
  const original = globalThis.localStorage
  // On node test runner localStorage may not exist, so we patch globalThis
  const mockStorage = new Map<string, string>()
  const mock: Storage = {
    get length() {
      return mockStorage.size
    },
    clear() {
      mockStorage.clear()
    },
    getItem(key: string) {
      return mockStorage.get(key) ?? null
    },
    key(index: number) {
      return Array.from(mockStorage.keys())[index] ?? null
    },
    removeItem(key: string) {
      mockStorage.delete(key)
    },
    setItem(key: string, value: string) {
      mockStorage.set(key, value)
    },
    ...overrides,
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    configurable: true,
    writable: true,
  })
  try {
    fn()
  } finally {
    if (original !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: original,
        configurable: true,
        writable: true,
      })
    }
  }
}

describe('active-home utilities', () => {
  it('loadActiveHomeId returns null when storage is empty', () => {
    withMockLocalStorage({}, () => {
      assert.strictEqual(loadActiveHomeId(), null)
    })
  })

  it('saveActiveHomeId persists a value that loadActiveHomeId retrieves', () => {
    withMockLocalStorage({}, () => {
      saveActiveHomeId('home-abc')
      assert.strictEqual(loadActiveHomeId(), 'home-abc')
    })
  })

  it('loadActiveHomeId trims whitespace and returns null for blank values', () => {
    withMockLocalStorage(
      {
        getItem(key: string) {
          if (key === ACTIVE_HOME_KEY) return '   '
          return null
        },
      },
      () => {
        assert.strictEqual(loadActiveHomeId(), null)
      },
    )
  })

  it('clearActiveHomeId removes the stored value', () => {
    withMockLocalStorage({}, () => {
      saveActiveHomeId('home-xyz')
      clearActiveHomeId()
      assert.strictEqual(loadActiveHomeId(), null)
    })
  })

  it('loadActiveHomeId returns null when localStorage throws', () => {
    withMockLocalStorage(
      {
        getItem() {
          throw new Error('SecurityError')
        },
      },
      () => {
        assert.strictEqual(loadActiveHomeId(), null)
      },
    )
  })

  it('saveActiveHomeId silently swallows errors when localStorage throws', () => {
    withMockLocalStorage(
      {
        setItem() {
          throw new Error('QuotaExceededError')
        },
      },
      () => {
        assert.doesNotThrow(() => saveActiveHomeId('home-err'))
      },
    )
  })

  it('clearActiveHomeId silently swallows errors when localStorage throws', () => {
    withMockLocalStorage(
      {
        removeItem() {
          throw new Error('SecurityError')
        },
      },
      () => {
        assert.doesNotThrow(() => clearActiveHomeId())
      },
    )
  })
})
