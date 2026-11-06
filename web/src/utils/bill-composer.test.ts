import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Member } from '../api/types.ts'
import { computeLiveSplitPreview, validateBillInput } from './bill-composer.ts'

describe('Bill Composer Validation: validateBillInput', () => {
  it('rejects empty or whitespace-only title', () => {
    const res1 = validateBillInput('', '50.00', 3)
    assert.strictEqual(res1.isTitleValid, false)
    assert.strictEqual(res1.isValid, false)
    assert.match(res1.titleError ?? '', /title/i)

    const res2 = validateBillInput('   ', '50.00', 3)
    assert.strictEqual(res2.isTitleValid, false)
    assert.strictEqual(res2.isValid, false)
  })

  it('accepts trimmed non-empty title', () => {
    const res = validateBillInput('  Con Edison Electric  ', '50.00', 3)
    assert.strictEqual(res.isTitleValid, true)
    assert.strictEqual(res.titleTrimmed, 'Con Edison Electric')
    assert.strictEqual(res.titleError, null)
  })

  it('rejects empty, zero, negative, or invalid amounts', () => {
    const resEmpty = validateBillInput('Internet', '', 2)
    assert.strictEqual(resEmpty.isAmountValid, false)
    assert.strictEqual(resEmpty.isValid, false)

    const resZero = validateBillInput('Internet', '0', 2)
    assert.strictEqual(resZero.isAmountValid, false)
    assert.strictEqual(resZero.isValid, false)

    const resZeroDecimal = validateBillInput('Internet', '$0.00', 2)
    assert.strictEqual(resZeroDecimal.isAmountValid, false)
    assert.strictEqual(resZeroDecimal.isValid, false)

    const resNegative = validateBillInput('Internet', '-25.00', 2)
    assert.strictEqual(resNegative.isAmountValid, false)
    assert.strictEqual(resNegative.isValid, false)

    const resInvalidFormat = validateBillInput('Internet', 'abc', 2)
    assert.strictEqual(resInvalidFormat.isAmountValid, false)
    assert.strictEqual(resInvalidFormat.isValid, false)

    const resExcessiveDecimals = validateBillInput('Internet', '25.999', 2)
    assert.strictEqual(resExcessiveDecimals.isAmountValid, false)
    assert.strictEqual(resExcessiveDecimals.isValid, false)
  })

  it('accepts valid dollar amounts and correctly parses whole cents', () => {
    const res1 = validateBillInput('Groceries', '120.50', 2)
    assert.strictEqual(res1.isAmountValid, true)
    assert.strictEqual(res1.parsedCents, 12050)
    assert.strictEqual(res1.amountError, null)

    const res2 = validateBillInput('Groceries', '$1,234.56', 2)
    assert.strictEqual(res2.isAmountValid, true)
    assert.strictEqual(res2.parsedCents, 123456)

    const resWhole = validateBillInput('Groceries', '75', 2)
    assert.strictEqual(resWhole.isAmountValid, true)
    assert.strictEqual(resWhole.parsedCents, 7500)
  })

  it('rejects bill creation when household has 0 members', () => {
    const res = validateBillInput('Whole Foods', '80.00', 0)
    assert.strictEqual(res.hasMembers, false)
    assert.strictEqual(res.isValid, false)
    assert.match(res.memberError ?? '', /resident/i)
  })

  it('confirms overall validity only when title, amount, and members are all satisfied', () => {
    const valid = validateBillInput('Con Edison Electricity', '$150.00', 3)
    assert.strictEqual(valid.isTitleValid, true)
    assert.strictEqual(valid.isAmountValid, true)
    assert.strictEqual(valid.hasMembers, true)
    assert.strictEqual(valid.isValid, true)
    assert.strictEqual(valid.parsedCents, 15000)
  })
})

describe('Live Split Preview Computation: computeLiveSplitPreview', () => {
  const members3: Member[] = [
    { id: 'm-1', homeId: 'h-1', name: 'Julian Vance' },
    { id: 'm-2', homeId: 'h-1', name: 'Elena Rostova' },
    { id: 'm-3', homeId: 'h-1', name: 'Marcus Chen' },
  ]

  it('returns null for null, non-positive cents or empty members', () => {
    assert.strictEqual(computeLiveSplitPreview(null, members3), null)
    assert.strictEqual(computeLiveSplitPreview(0, members3), null)
    assert.strictEqual(computeLiveSplitPreview(-100, members3), null)
    assert.strictEqual(computeLiveSplitPreview(5000, []), null)
  })

  it('computes exact even splits with zero remainder cents', () => {
    // $60.00 divided by 3 = $20.00 each
    const result = computeLiveSplitPreview(6000, members3)
    assert.ok(result)
    assert.strictEqual(result.totalCents, 6000)
    assert.strictEqual(result.formattedTotal, '$60.00')
    assert.strictEqual(result.memberCount, 3)
    assert.strictEqual(result.baseAmountCents, 2000)
    assert.strictEqual(result.remainderCents, 0)
    assert.strictEqual(result.shares.length, 3)

    assert.deepStrictEqual(result.shares, [
      {
        memberId: 'm-1',
        memberName: 'Julian Vance',
        amountCents: 2000,
        formattedAmount: '$20.00',
        isRemainderRecipient: false,
      },
      {
        memberId: 'm-2',
        memberName: 'Elena Rostova',
        amountCents: 2000,
        formattedAmount: '$20.00',
        isRemainderRecipient: false,
      },
      {
        memberId: 'm-3',
        memberName: 'Marcus Chen',
        amountCents: 2000,
        formattedAmount: '$20.00',
        isRemainderRecipient: false,
      },
    ])

    const totalSum = result.shares.reduce((acc, s) => acc + s.amountCents, 0)
    assert.strictEqual(totalSum, 6000)
  })

  it('distributes single remainder cent to the first member in insertion order', () => {
    // $100.00 divided by 3 = $33.33 each with 1 remainder cent ($33.34 for member 0)
    const result = computeLiveSplitPreview(10000, members3)
    assert.ok(result)
    assert.strictEqual(result.totalCents, 10000)
    assert.strictEqual(result.baseAmountCents, 3333)
    assert.strictEqual(result.remainderCents, 1)

    // First member gets base + 1 cent
    assert.strictEqual(result.shares[0]?.memberId, 'm-1')
    assert.strictEqual(result.shares[0]?.memberName, 'Julian Vance')
    assert.strictEqual(result.shares[0]?.amountCents, 3334)
    assert.strictEqual(result.shares[0]?.formattedAmount, '$33.34')
    assert.strictEqual(result.shares[0]?.isRemainderRecipient, true)

    // Subsequent members get exact base
    assert.strictEqual(result.shares[1]?.amountCents, 3333)
    assert.strictEqual(result.shares[1]?.formattedAmount, '$33.33')
    assert.strictEqual(result.shares[1]?.isRemainderRecipient, false)

    assert.strictEqual(result.shares[2]?.amountCents, 3333)
    assert.strictEqual(result.shares[2]?.formattedAmount, '$33.33')
    assert.strictEqual(result.shares[2]?.isRemainderRecipient, false)

    // Exact penny sum matches 10000 cents
    const totalSum = result.shares.reduce((acc, s) => acc + s.amountCents, 0)
    assert.strictEqual(totalSum, 10000)
  })

  it('distributes multiple remainder cents sequentially in insertion order', () => {
    const members4: Member[] = [
      { id: 'm-1', homeId: 'h-1', name: 'Julian' },
      { id: 'm-2', homeId: 'h-1', name: 'Elena' },
      { id: 'm-3', homeId: 'h-1', name: 'Marcus' },
      { id: 'm-4', homeId: 'h-1', name: 'Aria' },
    ]

    // $10.02 / 4 = 1002 cents / 4 = 250 base cents, remainder 2 cents
    const result = computeLiveSplitPreview(1002, members4)
    assert.ok(result)
    assert.strictEqual(result.totalCents, 1002)
    assert.strictEqual(result.baseAmountCents, 250)
    assert.strictEqual(result.remainderCents, 2)

    // First 2 members receive 251 cents
    assert.strictEqual(result.shares[0]?.amountCents, 251)
    assert.strictEqual(result.shares[0]?.isRemainderRecipient, true)

    assert.strictEqual(result.shares[1]?.amountCents, 251)
    assert.strictEqual(result.shares[1]?.isRemainderRecipient, true)

    // Remaining 2 members receive 250 cents
    assert.strictEqual(result.shares[2]?.amountCents, 250)
    assert.strictEqual(result.shares[2]?.isRemainderRecipient, false)

    assert.strictEqual(result.shares[3]?.amountCents, 250)
    assert.strictEqual(result.shares[3]?.isRemainderRecipient, false)

    // Exact penny sum matches 1002 cents
    const totalSum = result.shares.reduce((acc, s) => acc + s.amountCents, 0)
    assert.strictEqual(totalSum, 1002)
  })

  it('handles single-member households correctly', () => {
    const singleMember: Member[] = [{ id: 'm-solo', homeId: 'h-1', name: 'Solo Resident' }]
    const result = computeLiveSplitPreview(4567, singleMember)
    assert.ok(result)
    assert.strictEqual(result.totalCents, 4567)
    assert.strictEqual(result.remainderCents, 0)
    assert.strictEqual(result.shares.length, 1)
    assert.strictEqual(result.shares[0]?.amountCents, 4567)
    assert.strictEqual(result.shares[0]?.formattedAmount, '$45.67')
    assert.strictEqual(result.shares[0]?.isRemainderRecipient, false)
  })
})
