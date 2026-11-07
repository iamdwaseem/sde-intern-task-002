import { useId, useState } from 'react'
import type { Member } from '../api/types.ts'
import { computeLiveSplitPreview, validateBillInput } from '../utils/bill-composer.ts'
import { formatCents } from '../utils/money.ts'

export interface BillComposerProps {
  members: readonly Member[]
  isSubmitting?: boolean
  onSubmit?: (data: { title: string; totalCents: number }) => Promise<void> | void
  onCancel?: () => void
  initialTitle?: string
  initialAmount?: string
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]
  if (!first) return '—'
  if (parts.length === 1) return first.slice(0, 2).toUpperCase()
  const last = parts[parts.length - 1]
  const firstInitial = first[0] ?? ''
  const lastInitial = last && last.length > 0 ? (last[0] ?? '') : ''
  return (firstInitial + lastInitial).toUpperCase()
}

export function BillComposer({
  members,
  isSubmitting = false,
  onSubmit,
  onCancel,
  initialTitle = '',
  initialAmount = '',
}: BillComposerProps) {
  const [title, setTitle] = useState(initialTitle)
  const [amountInput, setAmountInput] = useState(initialAmount)
  const [touched, setTouched] = useState({ title: false, amount: false })
  const [submitAttempted, setSubmitAttempted] = useState(false)

  const titleInputId = useId()
  const amountInputId = useId()

  const validation = validateBillInput(title, amountInput, members.length)
  const splitPreview = computeLiveSplitPreview(validation.parsedCents, members)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitAttempted(true)

    if (!validation.isValid || validation.parsedCents === null || isSubmitting) {
      return
    }

    if (onSubmit) {
      await onSubmit({
        title: validation.titleTrimmed,
        totalCents: validation.parsedCents,
      })
    }
  }

  const showTitleError =
    (touched.title || submitAttempted) && !validation.isTitleValid && validation.titleError
  const showAmountError =
    (touched.amount || submitAttempted) && !validation.isAmountValid && validation.amountError

  return (
    <section
      className="bill-composer-card"
      aria-labelledby="bill-composer-title"
      data-testid="bill-composer"
    >
      <div className="composer-header">
        <div className="composer-eyebrow">Expenditure Composer</div>
        <h3 id="bill-composer-title" className="composer-title">
          Record Shared Bill
        </h3>
        <p className="composer-subtitle">
          Incurred expenses divide flatly across all active residents with penny remainders
          sequenced in member order.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="composer-form" noValidate>
        <div className="composer-fields-grid">
          {/* Bill Title Input */}
          <div className="composer-field">
            <label htmlFor={titleInputId} className="composer-label">
              Bill Title <span className="label-required">*</span>
            </label>
            <input
              id={titleInputId}
              data-testid="bill-title-input"
              type="text"
              className={`composer-input ${showTitleError ? 'input-error' : ''}`}
              placeholder="e.g., Con Edison Electric, Whole Foods Groceries"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, title: true }))}
              disabled={isSubmitting}
              autoComplete="off"
              required
            />
            {showTitleError && (
              <span className="field-error-message" role="alert">
                {validation.titleError}
              </span>
            )}
          </div>

          {/* Dollar Amount Input */}
          <div className="composer-field">
            <label htmlFor={amountInputId} className="composer-label">
              Total Incurred Amount ($ USD) <span className="label-required">*</span>
            </label>
            <div className="amount-input-wrapper">
              <span className="amount-currency-symbol" aria-hidden="true">
                $
              </span>
              <input
                id={amountInputId}
                data-testid="bill-amount-input"
                type="text"
                inputMode="decimal"
                className={`composer-input amount-input tabular-numbers ${
                  showAmountError ? 'input-error' : ''
                }`}
                placeholder="0.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, amount: true }))}
                disabled={isSubmitting}
                autoComplete="off"
                required
              />
            </div>
            {showAmountError && (
              <span className="field-error-message" role="alert">
                {validation.amountError}
              </span>
            )}
          </div>
        </div>

        {/* Member Availability Warning if 0 Members */}
        {!validation.hasMembers && (
          <div className="composer-member-warning" role="alert">
            <div className="warning-icon" aria-hidden="true">
              !
            </div>
            <div className="warning-content">
              <strong>Household Roster Empty:</strong> You must add at least one household resident
              before a bill can be divided and recorded.
            </div>
          </div>
        )}

        {/* Live Equal Allocation Preview */}
        <div className="composer-split-preview" data-testid="split-preview">
          <div className="split-preview-header">
            <div>
              <span className="split-preview-eyebrow">Allocation Engine</span>
              <h4 className="split-preview-title">Live Equal Split Breakdown</h4>
            </div>
            <div className="split-preview-badge">
              {members.length === 0
                ? 'Roster Required'
                : `${members.length} ${members.length === 1 ? 'Resident' : 'Residents'}`}
            </div>
          </div>

          {splitPreview ? (
            <>
              <div className="split-member-grid">
                {splitPreview.shares.map((share, idx) => (
                  <div
                    key={share.memberId}
                    className={`split-member-card ${
                      share.isRemainderRecipient ? 'card-has-remainder' : ''
                    }`}
                  >
                    <div className="split-member-avatar" aria-hidden="true">
                      {getInitials(share.memberName)}
                    </div>
                    <div className="split-member-info">
                      <div className="split-member-name">{share.memberName}</div>
                      <div className="split-member-order">Resident #{idx + 1}</div>
                    </div>
                    <div className="split-member-share">
                      <span className="share-amount tabular-numbers">{share.formattedAmount}</span>
                      {share.isRemainderRecipient && splitPreview.remainderCents > 0 && (
                        <span
                          className="remainder-pill"
                          title="Remainder cent allocated according to resident sequence"
                        >
                          +1¢
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Exact Penny Audit Strip */}
              <div className="split-audit-strip">
                <div className="audit-formula tabular-numbers">
                  <strong>Total:</strong> {splitPreview.formattedTotal} = {members.length} ×{' '}
                  {formatCents(splitPreview.baseAmountCents)}
                  {splitPreview.remainderCents > 0
                    ? ` + ${splitPreview.remainderCents}¢ remainder`
                    : ''}
                </div>
                <div className="audit-badge">
                  <span className="audit-dot" aria-hidden="true" />
                  Splits evenly, extra cents go to the first members
                </div>
              </div>
            </>
          ) : (
            <div className="split-empty-state">
              {members.length === 0 ? (
                <p>Enrolling residents on the right will activate live share previews.</p>
              ) : (
                <p>
                  Enter an expense amount above to preview the penny-exact allocation for{' '}
                  <strong>{members.length}</strong>{' '}
                  {members.length === 1 ? 'resident' : 'residents'}.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="composer-actions">
          {onCancel && (
            <button
              type="button"
              className="composer-cancel-btn"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
          )}

          <button
            type="submit"
            data-testid="record-bill-submit"
            className="composer-submit-btn"
            disabled={!validation.isValid || isSubmitting}
          >
            {isSubmitting
              ? 'Recording Bill...'
              : validation.isValid && validation.parsedCents !== null
                ? `Record Bill (${formatCents(validation.parsedCents)})`
                : 'Record Shared Bill'}
          </button>
        </div>
      </form>
    </section>
  )
}
