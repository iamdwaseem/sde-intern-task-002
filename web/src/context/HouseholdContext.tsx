import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { ApiClientError, apiClient } from '../api/client.ts'
import type { Bill, Home, MemberBalance } from '../api/types.ts'
import { clearActiveHomeId, loadActiveHomeId, saveActiveHomeId } from '../utils/active-home.ts'

type Flag = 'load' | 'home' | 'member' | 'bill' | 'payment'
type BusyFlag = 'home' | 'member' | 'bill'

export interface HouseholdContextValue {
  status: 'loading' | 'fresh' | 'ready' | 'load_error'
  home: Home | null
  members: { memberId: string; name: string }[]
  balances: MemberBalance[]
  bills: Bill[]
  loadError: string | null
  homeError: string | null
  memberError: string | null
  billError: string | null
  paymentError: string | null
  isSubmittingHome: boolean
  isSubmittingMember: boolean
  isSubmittingBill: boolean
  processingShareId: string | null
  keysRef: { current: Map<string, string> }
  createHousehold: (name: string) => Promise<boolean>
  addMember: (name: string) => Promise<boolean>
  createBill: (title: string, totalCents: number) => Promise<boolean>
  payShare: (billId: string, shareId: string) => Promise<boolean>
  resetHousehold: () => void
  reload: () => void
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null)

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'fresh' | 'ready' | 'load_error'>('loading')
  const [home, setHome] = useState<Home | null>(null)
  const [members, setMembers] = useState<{ memberId: string; name: string }[]>([])
  const [balances, setBalances] = useState<MemberBalance[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [errs, setErrs] = useState<Partial<Record<Flag, string | null>>>({})
  const [busy, setBusy] = useState<Partial<Record<BusyFlag, boolean>>>({})
  const [processingShareId, setProcessingShareId] = useState<string | null>(null)
  const keysRef = useRef<Map<string, string>>(new Map())

  const sync = useCallback(async (homeId: string, errorFlag: Flag = 'bill') => {
    try {
      const [bal, bl] = await Promise.all([
        apiClient.getBalances(homeId),
        apiClient.getBills(homeId),
      ])
      setMembers(bal.balances.map((b) => ({ memberId: b.memberId, name: b.name })))
      setBalances(bal.balances)
      setBills(bl.bills)
    } catch (err) {
      setErrs((e) => ({
        ...e,
        [errorFlag]: err instanceof Error ? err.message : 'Failed to refresh data.',
      }))
    }
  }, [])

  const loadData = useCallback(async (homeId: string): Promise<boolean> => {
    try {
      const [h, bal, b] = await Promise.all([
        apiClient.getHome(homeId),
        apiClient.getBalances(homeId),
        apiClient.getBills(homeId),
      ])
      setHome(h)
      setMembers(bal.balances.map((m) => ({ memberId: m.memberId, name: m.name })))
      setBalances(bal.balances)
      setBills(b.bills)
      setStatus('ready')
      return true
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        clearActiveHomeId()
        setStatus('fresh')
        setErrs((e) => ({
          ...e,
          load: 'Previous session was not found on the server. Please create a new home.',
        }))
        return false
      }
      setStatus('load_error')
      setErrs((e) => ({
        ...e,
        load: err instanceof Error ? err.message : 'Failed to load household data.',
      }))
      return false
    }
  }, [])

  useEffect(() => {
    const id = loadActiveHomeId()
    id ? loadData(id) : setStatus('fresh')
  }, [loadData])

  const reload = useCallback(() => {
    const id = loadActiveHomeId()
    if (!id) return setStatus('fresh')
    setStatus('loading')
    setErrs((e) => ({ ...e, load: null }))
    loadData(id)
  }, [loadData])

  const mutate = useCallback(
    async (flag: 'member' | 'bill', action: () => Promise<unknown>) => {
      setBusy((b) => ({ ...b, [flag]: true }))
      setErrs((e) => ({ ...e, [flag]: null }))
      let ok = false
      try {
        await action()
        ok = true
      } catch (err) {
        setErrs((e) => ({ ...e, [flag]: err instanceof Error ? err.message : 'Failed' }))
      } finally {
        setBusy((b) => ({ ...b, [flag]: false }))
      }
      if (home) await sync(home.id, flag)
      return ok
    },
    [home, sync],
  )

  const createHousehold = useCallback(
    async (name: string): Promise<boolean> => {
      const trimmed = name.trim()
      if (!trimmed || busy.home) {
        if (!trimmed) setErrs((e) => ({ ...e, home: 'Household name cannot be empty' }))
        return false
      }
      setBusy((b) => ({ ...b, home: true }))
      setErrs((e) => ({ ...e, home: null }))
      try {
        const newHome = await apiClient.createHome(trimmed)
        saveActiveHomeId(newHome.id)
        return await loadData(newHome.id)
      } catch (err) {
        setErrs((e) => ({
          ...e,
          home: err instanceof Error ? err.message : 'Failed to create household',
        }))
        return false
      } finally {
        setBusy((b) => ({ ...b, home: false }))
      }
    },
    [busy.home, loadData],
  )

  const addMember = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed || !home || busy.member) return false
      return mutate('member', () => apiClient.createMember(home.id, trimmed))
    },
    [home, busy.member, mutate],
  )

  const createBill = useCallback(
    async (title: string, totalCents: number) => {
      if (!home || busy.bill) return false
      return mutate('bill', () => apiClient.createBill(home.id, title, totalCents))
    },
    [home, busy.bill, mutate],
  )

  const payShare = useCallback(
    async (billId: string, shareId: string): Promise<boolean> => {
      if (!home || processingShareId !== null) return false
      let key = keysRef.current.get(shareId)
      if (!key) {
        key = crypto.randomUUID()
        keysRef.current.set(shareId, key)
      }
      setProcessingShareId(shareId)
      setErrs((e) => ({ ...e, payment: null }))
      let ok = false
      try {
        await apiClient.payShare(billId, shareId, key)
        keysRef.current.delete(shareId)
        ok = true
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 409) keysRef.current.delete(shareId)
        setErrs((e) => ({ ...e, payment: err instanceof Error ? err.message : 'Payment failed.' }))
      } finally {
        setProcessingShareId(null)
      }
      await sync(home.id, 'payment')
      return ok
    },
    [home, processingShareId, sync],
  )

  const resetHousehold = useCallback(() => {
    clearActiveHomeId()
    setStatus('fresh')
    setHome(null)
    setMembers([])
    setBalances([])
    setBills([])
    setErrs({})
    setProcessingShareId(null)
    keysRef.current.clear()
  }, [])

  return (
    <HouseholdContext.Provider
      value={{
        status,
        home,
        members,
        balances,
        bills,
        loadError: errs.load ?? null,
        homeError: errs.home ?? null,
        memberError: errs.member ?? null,
        billError: errs.bill ?? null,
        paymentError: errs.payment ?? null,
        isSubmittingHome: Boolean(busy.home),
        isSubmittingMember: Boolean(busy.member),
        isSubmittingBill: Boolean(busy.bill),
        processingShareId,
        keysRef,
        createHousehold,
        addMember,
        createBill,
        payShare,
        resetHousehold,
        reload,
      }}
    >
      {children}
    </HouseholdContext.Provider>
  )
}

export function useHousehold(): HouseholdContextValue {
  const context = useContext(HouseholdContext)
  if (!context) throw new Error('useHousehold must be used within a HouseholdProvider')
  return context
}
