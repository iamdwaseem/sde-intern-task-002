const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Formats a whole-cent safe integer into a standard USD currency string.
 *
 * Strict validation:
 * - Rejects non-safe-integers, NaN, Infinity, and fractional cents with RangeError.
 * - Supports negative safe integer amounts.
 *
 * Example:
 *   formatCents(1234) -> "$12.34"
 *   formatCents(0) -> "$0.00"
 *   formatCents(-500) -> "-$5.00"
 */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Amount must be a safe integer of cents, received ${cents}`)
  }

  return currencyFormatter.format(cents / 100)
}

/**
 * Parses user dollar string input into whole cents without binary floating-point drift.
 *
 * Note on financial arithmetic:
 * Direct multiplication like `parseFloat(str) * 100` introduces binary floating-point
 * rounding errors (e.g. `1.14 * 100 === 113.99999999999999`). To prevent loss of pennies,
 * we parse the dollar and cent components through decimal string splitting and integer arithmetic.
 *
 * Strict comma validation:
 * Thousands separators must follow valid grouping (e.g., "1,234", "12,345", "1,234,567").
 * Malformed groupings like "1,,234", "12,34", "123,45" are rejected.
 *
 * Valid inputs:
 *   "12.34" -> 1234
 *   "$12.34" -> 1234
 *   "10" -> 1000
 *   "10.5" -> 1050
 *   ".99" -> 99
 *   "1,234.56" -> 123456
 *   "0" -> 0
 *
 * Rejects:
 *   Negative values, malformed comma groupings, non-numeric strings, more than 2 decimal places.
 */
export function parseDollarInputToCents(input: string): number | null {
  if (typeof input !== 'string') {
    return null
  }

  const trimmed = input.trim().replace(/^\$/, '').trim()
  if (!trimmed) {
    return null
  }

  const parts = trimmed.split('.')
  if (parts.length > 2) {
    return null
  }

  const wholePart = parts[0] ?? ''
  const fractionPart = parts[1]

  // Validate fraction part if present: must be 1 or 2 digits
  if (fractionPart !== undefined && !/^\d{1,2}$/.test(fractionPart)) {
    return null
  }

  // Validate whole part:
  if (wholePart === '') {
    // Only valid if there was a fraction (e.g. ".99")
    if (fractionPart === undefined) {
      return null
    }
  } else {
    // Must be either unseparated digits or valid comma-separated thousands groups
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(wholePart)) {
      return null
    }
  }

  const cleanedWhole = wholePart ? wholePart.replace(/,/g, '') : '0'
  const dollars = Number.parseInt(cleanedWhole, 10)

  if (!Number.isSafeInteger(dollars)) {
    return null
  }

  const centsPart = (fractionPart ?? '').padEnd(2, '0')
  const cents = Number.parseInt(centsPart || '0', 10)

  const totalCents = dollars * 100 + cents

  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    return null
  }

  return totalCents
}

export interface CalculatedShare {
  memberId: string
  amountCents: number
}

/**
 * Splits a total amount in cents evenly across members, matching the backend's
 * remainder distribution logic exactly.
 *
 * Remainder cents are distributed 1-by-1 to the first members in the list:
 *   baseAmount = Math.floor(totalCents / memberCount)
 *   remainder = totalCents % memberCount
 *   shareAmount = baseAmount + (index < remainder ? 1 : 0)
 *
 * Guarantees:
 *   Sum of all share amounts === totalCents (no penny lost or gained).
 */
export function calculateSplitShares(
  totalCents: number,
  memberIds: readonly string[],
): CalculatedShare[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || memberIds.length === 0) {
    return []
  }

  const memberCount = memberIds.length
  const baseAmount = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  return memberIds.map((memberId, index) => ({
    memberId,
    amountCents: baseAmount + (index < remainder ? 1 : 0),
  }))
}
