import { createFileRoute } from '@tanstack/react-router'
import { Fragment, useState } from 'react'
import { BillComposer } from '../components/BillComposer.tsx'
import { useHousehold } from '../context/HouseholdContext.tsx'
import { calculateBillMetrics } from '../utils/bill-metrics.ts'
import { getInitials } from '../utils/initials.ts'
import { formatCents } from '../utils/money.ts'

export const Route = createFileRoute('/')({
  component: HouseholdLedgerView,
})

function HouseholdLedgerView() {
  const {
    status,
    home,
    members,
    balances,
    bills,
    loadError,
    homeError,
    memberError,
    billError,
    paymentError,
    isSubmittingHome,
    isSubmittingMember,
    isSubmittingBill,
    processingShareId,
    keysRef,
    createHousehold,
    addMember,
    createBill,
    payShare,
    reload,
  } = useHousehold()

  const [homeNameInput, setHomeNameInput] = useState('')
  const [memberNameInput, setMemberNameInput] = useState('')
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [billSuccess, setBillSuccess] = useState<string | null>(null)

  // 1. Loading skeleton
  if (status === 'loading') {
    return (
      <main className="app-shell" aria-busy="true" aria-label="Loading ledger">
        <div className="loading-shell">
          <div className="skeleton-box" style={{ height: '96px', width: '100%' }} />
          <div className="skeleton-box" style={{ height: '360px', width: '100%' }} />
        </div>
      </main>
    )
  }

  // 2. Load error state — show error banner with retry
  if (status === 'load_error') {
    return (
      <main className="app-shell">
        <div className="onboarding-wrapper">
          <section className="system-banner banner-recovery" role="alert" aria-live="polite">
            <div className="banner-content">
              <div className="banner-title">Failed to load household</div>
              <div className="banner-description">
                {loadError ?? 'An unexpected error occurred.'}
              </div>
              <button type="button" className="banner-action-btn" onClick={reload}>
                Retry
              </button>
            </div>
          </section>
        </div>
      </main>
    )
  }

  // 3. Fresh state — show create home form
  if (status === 'fresh') {
    const handleCreateHome = async (e: React.FormEvent) => {
      e.preventDefault()
      const ok = await createHousehold(homeNameInput)
      if (ok) {
        setHomeNameInput('')
      }
    }

    return (
      <main className="app-shell">
        <div className="onboarding-wrapper">
          {loadError && (
            <section className="system-banner banner-recovery" role="alert" aria-live="polite">
              <div className="banner-content">
                <div className="banner-title">Session Cleared</div>
                <div className="banner-description">{loadError}</div>
              </div>
            </section>
          )}

          <div className="onboarding-card">
            <span className="onboarding-eyebrow">Household Setup</span>
            <h1 className="onboarding-title">Create Home</h1>
            <p className="onboarding-description">
              Create a household to record shared living expenses, split bills equally among
              residents, and track who owes what.
            </p>

            <div className="onboarding-features">
              <div className="onboarding-feature-item">
                <span>
                  <strong>Equal Allocations:</strong> Flat split across all household residents.
                </span>
              </div>
              <div className="onboarding-feature-item">
                <span>
                  <strong>Splits evenly, extra cents go to the first members.</strong>
                </span>
              </div>
            </div>

            <form onSubmit={handleCreateHome} noValidate>
              <div className="form-group">
                <label htmlFor="home-name-input" className="form-label">
                  Household or Residence Name
                </label>
                <input
                  id="home-name-input"
                  type="text"
                  className="form-input"
                  placeholder="e.g., 74 Waverly Place, Apt 4B"
                  value={homeNameInput}
                  onChange={(e) => setHomeNameInput(e.target.value)}
                  disabled={isSubmittingHome}
                  required
                />
                <span className="form-hint">
                  A recognizable label for your home or shared apartment.
                </span>
              </div>

              {homeError && (
                <div className="form-error-banner" role="alert" aria-live="assertive">
                  <span>{homeError}</span>
                </div>
              )}

              <button
                type="submit"
                className="btn-submit-home"
                disabled={isSubmittingHome || !homeNameInput.trim()}
              >
                {isSubmittingHome ? 'Creating...' : 'Create Household'}
              </button>
            </form>
          </div>
        </div>
      </main>
    )
  }

  // 4. Ready state — main household view
  if (!home) return null

  const metrics = calculateBillMetrics(bills)

  const handleRecordBill = async ({ title, totalCents }: { title: string; totalCents: number }) => {
    setBillSuccess(null)
    const ok = await createBill(title, totalCents)
    if (ok) {
      setBillSuccess(`Recorded "${title}" (${formatCents(totalCents)}). Shares allocated.`)
      setIsComposerOpen(false)
    }
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await addMember(memberNameInput)
    if (ok) {
      setMemberNameInput('')
    }
  }

  // Map memberId -> name for share lookups
  const memberMap = new Map(members.map((m) => [m.memberId, m.name]))

  return (
    <main className="app-shell">
      {/* Editorial Page Header */}
      <section className="editorial-banner">
        <div className="editorial-header-left">
          <span className="editorial-eyebrow">Household Ledger</span>
          <h1 className="editorial-title">{home.name}</h1>
          <p className="editorial-description">
            Shared living expenses divided equally across active residents.
          </p>
        </div>

        <div className="header-status-badge">
          <span className="status-indicator" aria-hidden="true" />
          <span className="status-label">Cycle:</span>
          <span className="status-period">Active</span>
        </div>
      </section>

      {/* Two-Column Responsive Ledger */}
      <div className="ledger-layout">
        {/* Left Column: Bills */}
        <section className="ledger-surface" aria-labelledby="bills-heading">
          <div className="ledger-surface-header">
            <h2 id="bills-heading" className="ledger-surface-title">
              Bills
            </h2>
            <span className="ledger-surface-meta">
              {bills.length} recorded {bills.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>

          {/* Quick Metrics Strip */}
          <div className="stats-strip">
            <div className="stat-cell">
              <div className="stat-label">Total Incurred</div>
              <div className="stat-figure tabular-numbers">
                {formatCents(metrics.totalIncurredCents)}
              </div>
            </div>
            <div className="stat-cell">
              <div className="stat-label">Settled to Date</div>
              <div className="stat-figure tabular-numbers">{formatCents(metrics.settledCents)}</div>
            </div>
            <div className="stat-cell">
              <div className="stat-label">Pending Collection</div>
              <div className="stat-figure tabular-numbers">{formatCents(metrics.pendingCents)}</div>
            </div>
          </div>

          {bills.length > 0 ? (
            <table className="ledger-table" aria-label="Shared bills and expenditures">
              <thead>
                <tr>
                  <th scope="col">Bill</th>
                  <th scope="col" className="bill-allocation-desktop">
                    Allocation
                  </th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => {
                  const pendingSharesCount = bill.shares.filter((s) => s.paidAt === null).length
                  const isFullySettled = pendingSharesCount === 0

                  let allocationText = `${bill.shares.length} shares`
                  if (bill.shares.length > 0) {
                    const firstAmount = bill.shares[0]?.amountCents
                    const allEqual = bill.shares.every((s) => s.amountCents === firstAmount)
                    if (allEqual && firstAmount !== undefined) {
                      allocationText = `${bill.shares.length} × ${formatCents(firstAmount)}`
                    } else {
                      const amounts = bill.shares.map((s) => s.amountCents)
                      const minAmount = Math.min(...amounts)
                      const maxAmount = Math.max(...amounts)
                      allocationText = `${bill.shares.length} shares (${formatCents(minAmount)}–${formatCents(maxAmount)})`
                    }
                  }

                  return (
                    <Fragment key={bill.id}>
                      <tr className="bill-primary-row">
                        <td>
                          <div className="bill-item">
                            <span className="bill-title">{bill.title}</span>
                            <div className="bill-submeta">
                              <span className="bill-allocation-mobile tabular-numbers">
                                {allocationText}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="bill-allocation-desktop">
                          <span className="tabular-numbers">{allocationText}</span>
                        </td>
                        <td>
                          <span className="bill-amount tabular-numbers">
                            {formatCents(bill.totalCents)}
                          </span>
                        </td>
                        <td>
                          {isFullySettled ? (
                            <span className="badge badge-settled">Settled</span>
                          ) : (
                            <span className="badge badge-unsettled">
                              {pendingSharesCount} Pending
                            </span>
                          )}
                        </td>
                      </tr>
                      {bill.shares.length > 0 && (
                        <tr className="bill-shares-row">
                          <td colSpan={4} className="bill-shares-cell">
                            <div className="bill-shares-container">
                              <div className="bill-shares-grid">
                                {bill.shares.map((share) => {
                                  const memberName = memberMap.get(share.memberId) ?? 'Resident'
                                  const isPaid = share.paidAt !== null
                                  const isProcessing = processingShareId === share.id

                                  return (
                                    <div
                                      key={share.id}
                                      className={`share-pill-card ${isPaid ? 'share-paid' : 'share-unpaid'}`}
                                    >
                                      <div className="share-pill-user">
                                        <div className="share-pill-avatar" aria-hidden="true">
                                          {getInitials(memberName)}
                                        </div>
                                        <div className="share-pill-details">
                                          <span className="share-pill-name">{memberName}</span>
                                          <span className="share-pill-amount tabular-numbers">
                                            {formatCents(share.amountCents)}
                                          </span>
                                        </div>
                                      </div>

                                      <div className="share-pill-action">
                                        {isPaid ? (
                                          <span
                                            className="badge badge-settled"
                                            title={`Paid at ${share.paidAt}`}
                                          >
                                            ✓ Paid
                                          </span>
                                        ) : (
                                          <button
                                            type="button"
                                            className="btn-pay-share"
                                            onClick={() => payShare(bill.id, share.id)}
                                            disabled={processingShareId !== null}
                                            aria-label={`Pay ${formatCents(share.amountCents)} share for ${memberName}`}
                                          >
                                            {isProcessing
                                              ? 'Paying...'
                                              : keysRef.current.has(share.id)
                                                ? 'Retry Pay'
                                                : 'Pay'}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty-ledger-state">
              <div className="empty-ledger-icon" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <line x1="10" y1="9" x2="8" y2="9" />
                </svg>
              </div>
              <h3 className="empty-ledger-title">No Bills Recorded Yet</h3>
              <p className="empty-ledger-description">
                When bills are incurred, record them here. Each expense will divide equally among
                active residents.
              </p>
              <div className="empty-ledger-hint">
                <span className="badge badge-settled">Ready for Expenses</span>
                <span>
                  {members.length === 0
                    ? 'Add household residents on the right before recording bills.'
                    : `${members.length} resident${members.length === 1 ? '' : 's'} enrolled.`}
                </span>
              </div>
            </div>
          )}

          {/* Bill error/success feedback */}
          {billError && (
            <div
              style={{
                margin: 'var(--space-4) var(--space-6) 0',
                padding: 'var(--space-3) var(--space-4)',
                backgroundColor: 'var(--color-highlight-light)',
                border: '1px solid #eed0c8',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem',
                color: '#732314',
              }}
              role="alert"
            >
              <span>{billError}</span>
            </div>
          )}

          {billSuccess && (
            <div
              style={{
                margin: 'var(--space-4) var(--space-6) 0',
                padding: 'var(--space-3) var(--space-4)',
                backgroundColor: 'var(--color-secondary-light)',
                border: '1px solid rgba(91, 117, 32, 0.25)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem',
                color: 'var(--color-secondary)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
              role="status"
            >
              <span>{billSuccess}</span>
              <button
                type="button"
                className="banner-dismiss-btn"
                onClick={() => setBillSuccess(null)}
                style={{ marginLeft: 'var(--space-3)', color: 'inherit' }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Payment error feedback */}
          {paymentError && (
            <div
              style={{
                margin: 'var(--space-4) var(--space-6) 0',
                padding: 'var(--space-3) var(--space-4)',
                backgroundColor: 'var(--color-highlight-light)',
                border: '1px solid #eed0c8',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem',
                color: '#732314',
              }}
              role="alert"
              aria-live="assertive"
            >
              <span>{paymentError}</span>
            </div>
          )}

          {/* Bill Composer or Action Row */}
          {isComposerOpen ? (
            <BillComposer
              members={members.map((m) => ({ id: m.memberId, homeId: home.id, name: m.name }))}
              isSubmitting={isSubmittingBill}
              onSubmit={handleRecordBill}
              onCancel={() => setIsComposerOpen(false)}
            />
          ) : (
            <div
              style={{
                padding: 'var(--space-4) var(--space-6)',
                borderTop: '1px solid var(--color-border-subtle)',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button type="button" className="btn-action" onClick={() => setIsComposerOpen(true)}>
                Record Shared Bill
              </button>
            </div>
          )}
        </section>

        {/* Right Column: Members */}
        <aside className="ledger-surface" aria-labelledby="members-heading">
          <div className="ledger-surface-header">
            <h2 id="members-heading" className="ledger-surface-title">
              Members
            </h2>
            <span className="badge badge-settled">
              {members.length} {members.length === 1 ? 'Resident' : 'Residents'}
            </span>
          </div>

          {members.length === 0 ? (
            <div className="empty-members-box">
              <p>No residents enrolled yet.</p>
              <p style={{ marginTop: '4px', fontSize: '0.8125rem' }}>
                Add your household members below to establish the sharing roster.
              </p>
            </div>
          ) : (
            <ul className="member-list">
              {members.map((member) => {
                const balanceEntry = balances.find((b) => b.memberId === member.memberId)

                return (
                  <li key={member.memberId} className="member-row">
                    <div className="member-profile">
                      <div className="member-avatar" aria-hidden="true">
                        {getInitials(member.name)}
                      </div>
                      <div>
                        <div className="member-name">{member.name}</div>
                        <div className="member-role">Resident</div>
                      </div>
                    </div>

                    <div className="member-due">
                      {balanceEntry !== undefined ? (
                        balanceEntry.outstandingCents > 0 ? (
                          <>
                            <div className="member-due-amount owes tabular-numbers">
                              {formatCents(balanceEntry.outstandingCents)}
                            </div>
                            <div className="member-due-label">Outstanding</div>
                          </>
                        ) : (
                          <>
                            <div className="member-due-amount cleared tabular-numbers">$0.00</div>
                            <div className="member-due-label">Settled</div>
                          </>
                        )
                      ) : (
                        <>
                          <div className="member-due-unavailable">Pending sync</div>
                          <div className="member-due-label">Unsynced</div>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Add Resident Inline Form */}
          <div className="add-member-card">
            <label htmlFor="resident-name-input" className="add-member-label">
              Add Household Resident
            </label>
            <form onSubmit={handleAddMember} className="add-member-form">
              <input
                id="resident-name-input"
                type="text"
                className="add-member-input"
                placeholder="e.g., Julian Vance"
                value={memberNameInput}
                onChange={(e) => setMemberNameInput(e.target.value)}
                disabled={isSubmittingMember}
                required
              />
              <button
                type="submit"
                className="add-member-btn"
                disabled={isSubmittingMember || !memberNameInput.trim()}
              >
                {isSubmittingMember ? 'Adding...' : 'Add Resident'}
              </button>
            </form>
            {memberError && (
              <div className="member-error-container" role="alert" aria-live="assertive">
                <div className="member-error-text">{memberError}</div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  )
}
