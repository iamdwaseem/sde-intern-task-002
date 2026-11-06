import type { Member } from '../api/types.ts'
import { calculateSplitShares, formatCents, parseDollarInputToCents } from './money.ts'

export interface BillInputValidation {
  isValid: boolean
  titleTrimmed: string
  isTitleValid: boolean
  titleError: string | null
  parsedCents: number | null
  isAmountValid: boolean
  amountError: string | null
  hasMembers: boolean
  memberError: string | null
}

export function validateBillInput(
  title: string,
  amountInput: string,
  memberCount: number,
): BillInputValidation {
  const titleTrimmed = typeof title === 'string' ? title.trim() : ''
  const isTitleValid = titleTrimmed.length > 0
  const titleError = isTitleValid ? null : 'Please enter a bill title or description.'

  const parsedCents = parseDollarInputToCents(amountInput)
  const isAmountValid = parsedCents !== null && parsedCents > 0

  let amountError: string | null = null
  if (!amountInput?.trim()) {
    amountError = 'Please enter a total bill amount.'
  } else if (!isAmountValid) {
    amountError = 'Please enter a valid dollar amount greater than $0.00.'
  }

  const hasMembers = Number.isSafeInteger(memberCount) && memberCount > 0
  const memberError = hasMembers
    ? null
    : 'Add at least one household resident before recording a bill.'

  const isValid = isTitleValid && isAmountValid && hasMembers

  return {
    isValid,
    titleTrimmed,
    isTitleValid,
    titleError,
    parsedCents,
    isAmountValid,
    amountError,
    hasMembers,
    memberError,
  }
}

export interface MemberSplitItem {
  memberId: string
  memberName: string
  amountCents: number
  formattedAmount: string
  isRemainderRecipient: boolean
}

export interface LiveSplitResult {
  totalCents: number
  formattedTotal: string
  memberCount: number
  baseAmountCents: number
  remainderCents: number
  shares: MemberSplitItem[]
}

/**
 * Computes live equal allocation across household members using calculateSplitShares().
 * Distributes remainder cents in member insertion order.
 */
export function computeLiveSplitPreview(
  totalCents: number | null,
  members: readonly Member[],
): LiveSplitResult | null {
  if (
    totalCents === null ||
    !Number.isSafeInteger(totalCents) ||
    totalCents <= 0 ||
    members.length === 0
  ) {
    return null
  }

  const memberIds = members.map((m) => m.id)
  const calculatedShares = calculateSplitShares(totalCents, memberIds)
  if (calculatedShares.length === 0) {
    return null
  }

  const memberCount = members.length
  const baseAmountCents = Math.floor(totalCents / memberCount)
  const remainderCents = totalCents % memberCount

  const shares: MemberSplitItem[] = calculatedShares.map((share, index) => {
    const member = members[index]
    const memberName = member ? member.name : `Member ${index + 1}`
    return {
      memberId: share.memberId,
      memberName,
      amountCents: share.amountCents,
      formattedAmount: formatCents(share.amountCents),
      isRemainderRecipient: index < remainderCents,
    }
  })

  return {
    totalCents,
    formattedTotal: formatCents(totalCents),
    memberCount,
    baseAmountCents,
    remainderCents,
    shares,
  }
}
