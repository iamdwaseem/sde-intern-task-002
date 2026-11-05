import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateSplitShares, formatCents, parseDollarInputToCents } from './money.ts'

describe('formatCents', () => {
  it('formats positive safe integers correctly', () => {
    assert.equal(formatCents(0), '$0.00')
    assert.equal(formatCents(1), '$0.01')
    assert.equal(formatCents(50), '$0.50')
    assert.equal(formatCents(1234), '$12.34')
    assert.equal(formatCents(123456), '$1,234.56')
  })

  it('preserves support for negative safe integer amounts', () => {
    assert.equal(formatCents(-1), '-$0.01')
    assert.equal(formatCents(-500), '-$5.00')
    assert.equal(formatCents(-123456), '-$1,234.56')
  })

  it('rejects fractional cents with RangeError and never rounds silently', () => {
    assert.throws(() => formatCents(12.5), RangeError)
    assert.throws(() => formatCents(0.1), RangeError)
    assert.throws(() => formatCents(-99.9), RangeError)
  })

  it('rejects NaN and Infinity with RangeError instead of converting to $0.00', () => {
    assert.throws(() => formatCents(Number.NaN), RangeError)
    assert.throws(() => formatCents(Number.POSITIVE_INFINITY), RangeError)
    assert.throws(() => formatCents(Number.NEGATIVE_INFINITY), RangeError)
  })

  it('rejects non-safe integers with RangeError', () => {
    assert.throws(() => formatCents(Number.MAX_SAFE_INTEGER + 1), RangeError)
    assert.throws(() => formatCents(Number.MIN_SAFE_INTEGER - 1), RangeError)
  })
})

describe('parseDollarInputToCents', () => {
  it('parses normal whole dollar and cent values', () => {
    assert.equal(parseDollarInputToCents('0'), 0)
    assert.equal(parseDollarInputToCents('0.00'), 0)
    assert.equal(parseDollarInputToCents('$0.00'), 0)
    assert.equal(parseDollarInputToCents('10'), 1000)
    assert.equal(parseDollarInputToCents('10.5'), 1050)
    assert.equal(parseDollarInputToCents('10.50'), 1050)
    assert.equal(parseDollarInputToCents('$10.50'), 1050)
    assert.equal(parseDollarInputToCents('  $10.50  '), 1050)
    assert.equal(parseDollarInputToCents('.99'), 99)
    assert.equal(parseDollarInputToCents('$.99'), 99)
  })

  it('preserves string-based decimal precision without floating point drift', () => {
    // 1.14 * 100 in binary floating point is 113.99999999999999
    assert.equal(parseDollarInputToCents('1.14'), 114)
    assert.equal(parseDollarInputToCents('4.56'), 456)
    assert.equal(parseDollarInputToCents('19.99'), 1999)
    assert.equal(parseDollarInputToCents('29.95'), 2995)
  })

  it('accepts correctly grouped thousands separators', () => {
    assert.equal(parseDollarInputToCents('1,234'), 123400)
    assert.equal(parseDollarInputToCents('1,234.56'), 123456)
    assert.equal(parseDollarInputToCents('$1,234.56'), 123456)
    assert.equal(parseDollarInputToCents('12,345.67'), 1234567)
    assert.equal(parseDollarInputToCents('123,456.78'), 12345678)
    assert.equal(parseDollarInputToCents('1,234,567.89'), 123456789)
  })

  it('rejects malformed comma grouping', () => {
    assert.equal(parseDollarInputToCents('1,,234'), null)
    assert.equal(parseDollarInputToCents('12,34'), null)
    assert.equal(parseDollarInputToCents('123,45'), null)
    assert.equal(parseDollarInputToCents(',123'), null)
    assert.equal(parseDollarInputToCents('123,'), null)
    assert.equal(parseDollarInputToCents('1,234,56'), null)
    assert.equal(parseDollarInputToCents('1,23,456'), null)
  })

  it('rejects invalid, negative, or excessive precision inputs', () => {
    assert.equal(parseDollarInputToCents(''), null)
    assert.equal(parseDollarInputToCents('   '), null)
    assert.equal(parseDollarInputToCents('abc'), null)
    assert.equal(parseDollarInputToCents('-10'), null)
    assert.equal(parseDollarInputToCents('-$10.00'), null)
    assert.equal(parseDollarInputToCents('10.999'), null)
    assert.equal(parseDollarInputToCents('10.5.5'), null)
  })
})

describe('calculateSplitShares', () => {
  it('returns empty array for invalid inputs', () => {
    assert.deepEqual(calculateSplitShares(100, []), [])
    assert.deepEqual(calculateSplitShares(0, ['m1']), [])
    assert.deepEqual(calculateSplitShares(-100, ['m1']), [])
    assert.deepEqual(calculateSplitShares(100.5, ['m1']), [])
  })

  it('handles even splits with zero remainder', () => {
    const shares = calculateSplitShares(100, ['m1', 'm2'])
    assert.deepEqual(shares, [
      { memberId: 'm1', amountCents: 50 },
      { memberId: 'm2', amountCents: 50 },
    ])
    assert.equal(
      shares.reduce((sum, s) => sum + s.amountCents, 0),
      100,
    )
  })

  it('distributes single cent remainder to the first member', () => {
    const shares = calculateSplitShares(100, ['m1', 'm2', 'm3'])
    assert.deepEqual(shares, [
      { memberId: 'm1', amountCents: 34 },
      { memberId: 'm2', amountCents: 33 },
      { memberId: 'm3', amountCents: 33 },
    ])
    assert.equal(
      shares.reduce((sum, s) => sum + s.amountCents, 0),
      100,
    )
  })

  it('distributes multiple remainder cents sequentially', () => {
    const shares = calculateSplitShares(10, ['m1', 'm2', 'm3', 'm4'])
    assert.deepEqual(shares, [
      { memberId: 'm1', amountCents: 3 },
      { memberId: 'm2', amountCents: 3 },
      { memberId: 'm3', amountCents: 2 },
      { memberId: 'm4', amountCents: 2 },
    ])
    assert.equal(
      shares.reduce((sum, s) => sum + s.amountCents, 0),
      10,
    )
  })
})
