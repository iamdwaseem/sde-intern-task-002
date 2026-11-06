import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { apiClient } from '../api/client.ts'
import type { Home, PendingMemberCreation, StoredHomeSession } from '../api/types.ts'
import {
  addHouseholdMember,
  clearActiveHomeId,
  clearHomeSession,
  persistNewHouseholdSession,
  reconcileHouseholdRoster,
  restoreHouseholdSession,
} from '../utils/storage.ts'

export type HouseholdStatus =
  | 'loading'
  | 'fresh'
  | 'corrupted'
  | 'invalid_home'
  | 'api_unavailable'
  | 'stale'
  | 'ready'

export interface HouseholdContextValue {
  status: HouseholdStatus
  session: StoredHomeSession | null
  error: string | null
  homeError: string | null
  memberError: string | null
  persistenceWarning: string | null
  pendingMember: PendingMemberCreation | null
  isSubmittingHome: boolean
  isSubmittingMember: boolean
  isReconciling: boolean
  createHousehold: (name: string) => Promise<boolean>
  addMember: (name: string) => Promise<boolean>
  reconcileRoster: () => Promise<boolean>
  dismissRecoveryBanner: () => void
  dismissPersistenceWarning: () => void
  resetHousehold: () => void
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null)

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<HouseholdStatus>('loading')
  const [session, setSession] = useState<StoredHomeSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [homeError, setHomeError] = useState<string | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null)
  const [pendingMember, setPendingMember] = useState<PendingMemberCreation | null>(null)
  const [isSubmittingHome, setIsSubmittingHome] = useState(false)
  const [isSubmittingMember, setIsSubmittingMember] = useState(false)
  const [isReconciling, setIsReconciling] = useState(false)

  // Initialize session on mount
  useEffect(() => {
    let mounted = true

    async function restore() {
      const result = await restoreHouseholdSession(apiClient)
      if (!mounted) return

      switch (result.status) {
        case 'fresh':
          setStatus('fresh')
          setSession(null)
          setError(null)
          break
        case 'corrupted':
          setStatus('corrupted')
          setSession(null)
          setError(result.error ?? null)
          break
        case 'invalid_home':
          setStatus('invalid_home')
          setSession(null)
          setError(result.error ?? null)
          break
        case 'api_unavailable':
          setStatus('api_unavailable')
          setSession(result.session ?? null)
          setError(result.error ?? null)
          if (result.persistenceWarning) {
            setPersistenceWarning(result.persistenceWarning)
          }
          break
        case 'stale':
          setStatus('stale')
          setSession(result.session ?? null)
          setError(result.error ?? null)
          if (result.persistenceWarning) {
            setPersistenceWarning(result.persistenceWarning)
          }
          break
        case 'ready':
          setStatus('ready')
          setSession(result.session ?? null)
          setError(null)
          if (result.persistenceWarning) {
            setPersistenceWarning(result.persistenceWarning)
          }
          break
      }

      // Initialize pendingMember from restored session
      if (result.session?.pendingMemberCreation) {
        setPendingMember(result.session.pendingMemberCreation)
        setMemberError(
          `Network failure during resident creation for "${result.session.pendingMemberCreation.name}". The outcome cannot yet be confirmed. To prevent duplicate entries, do not retry immediately. Use "Reconcile with Server" once connectivity is restored.`,
        )
      } else {
        setPendingMember(null)
      }
    }

    restore()

    return () => {
      mounted = false
    }
  }, [])

  const createHousehold = useCallback(
    async (name: string): Promise<boolean> => {
      const trimmed = name.trim()
      if (!trimmed) {
        setHomeError('Household name cannot be empty')
        return false
      }

      if (isSubmittingHome) {
        return false
      }

      setIsSubmittingHome(true)
      setHomeError(null)

      try {
        const home: Home = await apiClient.createHome(trimmed)

        // Persist session before writing the active household ID and check both results
        const {
          session: newSession,
          sessionSaved,
          activeIdSaved,
        } = persistNewHouseholdSession(home)

        // Retain household in React state regardless of local storage outcome
        setSession(newSession)
        setStatus('ready')
        setError(null)
        setHomeError(null)

        if (!sessionSaved || !activeIdSaved) {
          setPersistenceWarning(
            'Household created on the server, but local browser storage failed. Your session is active in memory but will not survive a page reload.',
          )
        } else {
          setPersistenceWarning(null)
        }

        return true
      } catch (err) {
        // Only set homeError if the server creation call actually failed
        setHomeError(err instanceof Error ? err.message : 'Failed to establish household')
        return false
      } finally {
        setIsSubmittingHome(false)
      }
    },
    [isSubmittingHome],
  )

  const addMember = useCallback(
    async (name: string): Promise<boolean> => {
      const trimmed = name.trim()
      if (!trimmed) {
        setMemberError('Resident name cannot be empty')
        return false
      }

      if (!session) {
        setMemberError('No active household session')
        return false
      }

      if (isSubmittingMember) {
        return false
      }

      setIsSubmittingMember(true)
      setMemberError(null)

      try {
        const result = await addHouseholdMember(apiClient, session, trimmed)
        switch (result.status) {
          case 'success':
            setSession(result.session)
            setStatus('ready')
            setError(null)
            setMemberError(null)
            setPendingMember(null)
            if (result.persistenceWarning) {
              setPersistenceWarning(result.persistenceWarning)
            }
            return true

          case 'api_unavailable':
            setSession(result.session)
            setStatus('api_unavailable')
            setError(
              `Offline: Resident added, but balance refresh failed (${result.error}). Displaying cached balances.`,
            )
            setMemberError(`Resident added, but balances could not be refreshed (${result.error})`)
            if (result.persistenceWarning) {
              setPersistenceWarning(result.persistenceWarning)
            }
            return true

          case 'stale':
            setSession(result.session)
            setStatus('stale')
            setError(
              `Stale Balances: Resident added, but balance verification could not be completed (${result.error}). Displaying cached balances.`,
            )
            setMemberError(`Resident added, but balances could not be verified (${result.error})`)
            if (result.persistenceWarning) {
              setPersistenceWarning(result.persistenceWarning)
            }
            return true

          case 'uncertain':
            setSession(result.session)
            setPendingMember(result.pendingMember)
            setMemberError(result.error)
            if (result.persistenceWarning) {
              setPersistenceWarning(result.persistenceWarning)
            }
            return false

          case 'invalid_home':
            setSession(null)
            setStatus('invalid_home')
            setError(result.error)
            setMemberError(null)
            setPendingMember(null)
            return false

          case 'error':
            setMemberError(result.error)
            return false
        }
      } finally {
        setIsSubmittingMember(false)
      }
    },
    [session, isSubmittingMember],
  )

  const reconcileRoster = useCallback(async (): Promise<boolean> => {
    if (!session) return false
    setIsReconciling(true)
    try {
      const result = await reconcileHouseholdRoster(apiClient, session, pendingMember)
      switch (result.status) {
        case 'ready':
          setSession(result.session)
          setStatus('ready')
          setError(null)
          if (result.resolvedPending) {
            setPendingMember(null)
            setMemberError(null)
          } else if (result.resolvedPending === false) {
            // Keep pendingMember and preserve uncertain warning
            setMemberError(
              result.error ??
                `Reconciliation checked the server, but resident has not appeared yet. The outcome remains uncertain; avoid re-adding this resident to prevent duplicates.`,
            )
          }
          if (result.persistenceWarning) {
            setPersistenceWarning(result.persistenceWarning)
          }
          return true

        case 'api_unavailable':
          setStatus('api_unavailable')
          setError(result.error)
          return false

        case 'stale':
          setStatus('stale')
          setError(result.error)
          return false

        case 'invalid_home':
          setSession(null)
          setStatus('invalid_home')
          setError(result.error)
          setPendingMember(null)
          setMemberError(null)
          return false
      }
    } finally {
      setIsReconciling(false)
    }
  }, [session, pendingMember])

  const dismissRecoveryBanner = useCallback(() => {
    setError(null)
  }, [])

  const dismissPersistenceWarning = useCallback(() => {
    setPersistenceWarning(null)
  }, [])

  const resetHousehold = useCallback(() => {
    if (session?.home.id) {
      clearHomeSession(session.home.id)
    }
    clearActiveHomeId()
    setSession(null)
    setStatus('fresh')
    setError(null)
    setHomeError(null)
    setMemberError(null)
    setPendingMember(null)
    setPersistenceWarning(null)
  }, [session])

  return (
    <HouseholdContext.Provider
      value={{
        status,
        session,
        error,
        homeError,
        memberError,
        persistenceWarning,
        pendingMember,
        isSubmittingHome,
        isSubmittingMember,
        isReconciling,
        createHousehold,
        addMember,
        reconcileRoster,
        dismissRecoveryBanner,
        dismissPersistenceWarning,
        resetHousehold,
      }}
    >
      {children}
    </HouseholdContext.Provider>
  )
}

export function useHousehold(): HouseholdContextValue {
  const context = useContext(HouseholdContext)
  if (!context) {
    throw new Error('useHousehold must be used within a HouseholdProvider')
  }
  return context
}
