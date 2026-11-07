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

export interface BillsResponse {
  bills: Bill[]
}

export interface ApiErrorResponse {
  error: string
}

export const ACTIVE_HOME_STORAGE_KEY = 'bill_splitter_active_home'
