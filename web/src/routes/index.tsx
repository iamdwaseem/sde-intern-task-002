import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { BillComposer } from '../components/BillComposer.tsx'
import { useHousehold } from '../context/HouseholdContext.tsx'
import { formatCents } from '../utils/money.ts'
import { calculateBillMetrics, formatBillDate } from '../utils/storage.ts'

export const Route = createFileRoute('/')({
  component: HouseholdLedgerView,
})

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

function HouseholdLedgerView() {
  const {
    status,
    session,
    error,
    homeError,
    memberError,
    billError,
    persistenceWarning,
    pendingMember,
    isSubmittingHome,
    isSubmittingMember,
    isSubmittingBill,
    isReconciling,
    createHousehold,
    addMember,
    createBill,
    reconcileRoster,
    dismissRecoveryBanner,
    dismissPersistenceWarning,
    dismissBillError,
  } = useHousehold()

  const [homeNameInput, setHomeNameInput] = useState('')
  const [memberNameInput, setMemberNameInput] = useState('')
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [billSuccess, setBillSuccess] = useState<string | null>(null)

  // 1. Initial restoration loading state
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

  // 2. Household Onboarding View (fresh, corrupted, or 404 recovery)
  if (status === 'fresh' || status === 'corrupted' || status === 'invalid_home') {
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
          {/* Recovery Notification if returning from an invalid or corrupted session */}
          {error && (
            <section className="system-banner banner-recovery" role="alert" aria-live="polite">
              <div className="banner-icon" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="banner-content">
                <div className="banner-title">
                  {status === 'invalid_home'
                    ? 'Household Session Cleared (Server 404)'
                    : 'Session Storage Reset'}
                </div>
                <div className="banner-description">{error}</div>
                <button
                  type="button"
                  className="banner-dismiss-btn"
                  onClick={dismissRecoveryBanner}
                >
                  Dismiss notice
                </button>
              </div>
            </section>
          )}

          <div className="onboarding-card">
            <span className="onboarding-eyebrow">Household Setup</span>
            <h1 className="onboarding-title">Establish Your Shared Ledger</h1>
            <p className="onboarding-description">
              Create a dedicated household ledger to record living expenditures, split utilities
              with penny-perfect accuracy, and maintain a transparent record for all residents.
            </p>

            <div className="onboarding-features">
              <div className="onboarding-feature-item">
                <span className="onboarding-feature-bullet" aria-hidden="true">
                  §
                </span>
                <span>
                  <strong>Equal Allocations:</strong> Flat split across all household residents.
                </span>
              </div>
              <div className="onboarding-feature-item">
                <span className="onboarding-feature-bullet" aria-hidden="true">
                  §
                </span>
                <span>
                  <strong>Sequential Pennies:</strong> Odd remainders distributed in member roster
                  order.
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
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{homeError}</span>
                </div>
              )}

              <button
                type="submit"
                className="btn-submit-home"
                disabled={isSubmittingHome || !homeNameInput.trim()}
              >
                {isSubmittingHome ? 'Establishing Ledger...' : 'Create Household Ledger'}
              </button>
            </form>
          </div>
        </div>
      </main>
    )
  }

  // 3. Active Household View (ready or api_unavailable)
  if (!session) {
    return null
  }

  const isOffline = status === 'api_unavailable'
  const isStale = status === 'stale'

  const metrics = calculateBillMetrics(session.bills)

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

  return (
    <main className="app-shell">
      {/* Offline Notice Banner */}
      {isOffline && (
        <section className="system-banner banner-offline" role="status" aria-live="polite">
          <div className="banner-icon" aria-hidden="true">
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
              <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
          </div>
          <div className="banner-content">
            <div className="banner-title">Offline Mode — Local Cache Active</div>
            <div className="banner-description">
              The ledger cannot communicate with the server right now. Displaying locally preserved
              member roster and cached balances. Offline actions are not queued for automatic
              synchronization and must be retried once connectivity is restored.
            </div>
          </div>
        </section>
      )}

      {/* Stale / Balance Verification Incomplete Banner */}
      {isStale && (
        <section className="system-banner banner-stale" role="status" aria-live="polite">
          <div className="banner-icon" aria-hidden="true">
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="banner-content">
            <div className="banner-title">Stale Balances — Balance Refresh Incomplete</div>
            <div className="banner-description">
              {error ??
                'Balances could not be verified with the server. Displaying previously cached balances.'}
            </div>
            <button
              type="button"
              className="banner-action-btn"
              onClick={() => reconcileRoster()}
              disabled={isReconciling}
            >
              {isReconciling ? 'Reconciling...' : 'Reconcile with Server'}
            </button>
          </div>
        </section>
      )}

      {/* Local Storage Persistence Warning */}
      {persistenceWarning && (
        <section className="system-banner banner-warning" role="alert" aria-live="polite">
          <div className="banner-icon" aria-hidden="true">
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="banner-content">
            <div className="banner-title">Storage Persistence Warning</div>
            <div className="banner-description">{persistenceWarning}</div>
            <button
              type="button"
              className="banner-dismiss-btn"
              onClick={dismissPersistenceWarning}
            >
              Dismiss warning
            </button>
          </div>
        </section>
      )}

      {/* Editorial Page Header */}
      <section className="editorial-banner">
        <div className="editorial-header-left">
          <span className="editorial-eyebrow">Accounting Ledger</span>
          <h1 className="editorial-title">{session.home.name}</h1>
          <p className="editorial-description">
            Shared living expenses, municipal utilities, and domestic allocations divided equally
            across active residents.
          </p>
        </div>

        <div className="header-status-badge">
          <span
            className={`status-indicator ${isOffline ? 'dot-offline' : isStale ? 'dot-stale' : ''}`}
            aria-hidden="true"
          />
          <span className="status-label">{isOffline || isStale ? 'Status:' : 'Cycle:'}</span>
          <span className="status-period">
            {isOffline ? 'Cached View' : isStale ? 'Stale Balances' : 'Active'}
          </span>
        </div>
      </section>

      {/* Two-Column Responsive Ledger Composition */}
      <div className="ledger-layout">
        {/* Left Column: Shared Bills & Expenditures */}
        <section className="ledger-surface" aria-labelledby="bills-heading">
          <div className="ledger-surface-header">
            <h2 id="bills-heading" className="ledger-surface-title">
              Shared Bills & Expenditures
            </h2>
            <span className="ledger-surface-meta">
              {session.bills.length} recorded {session.bills.length === 1 ? 'entry' : 'entries'}
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

          {/* Actual Bills Ledger Table or Authentic Empty State */}
          {session.bills.length > 0 ? (
            <table className="ledger-table" aria-label="Shared bills and expenditures">
              <thead>
                <tr>
                  <th scope="col">Expenditure / Bill</th>
                  <th scope="col" className="bill-allocation-desktop">
                    Allocation
                  </th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {session.bills.map((bill) => {
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
                    <tr key={bill.id}>
                      <td>
                        <div className="bill-item">
                          <span className="bill-title">{bill.title}</span>
                          <div className="bill-submeta">
                            <span className="bill-date">
                              {formatBillDate(bill.clientCreatedAt)}
                            </span>
                            <span className="bill-allocation-mobile tabular-numbers">
                              • {allocationText}
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
              <h3 className="empty-ledger-title">No Shared Bills Recorded Yet</h3>
              <p className="empty-ledger-description">
                When bills are incurred, record them here. Each expense will divide equally among
                active residents with remainder pennies distributed sequentially.
              </p>
              <div className="empty-ledger-hint">
                <span className="badge badge-settled">Ready for Expenses</span>
                <span>
                  {session.members.length === 0
                    ? 'Add household residents on the right before recording bills.'
                    : `${session.members.length} resident${session.members.length === 1 ? '' : 's'} enrolled in the allocation roster.`}
                </span>
              </div>
            </div>
          )}

          {/* Bill Feedback Notifications */}
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
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
              role="alert"
            >
              <span>{billError}</span>
              <button
                type="button"
                className="banner-dismiss-btn"
                onClick={dismissBillError}
                style={{ marginLeft: 'var(--space-3)', color: 'inherit' }}
              >
                Dismiss
              </button>
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

          {/* Bill Composer or Action Row */}
          {isComposerOpen ? (
            <BillComposer
              members={session.members}
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

        {/* Right Column: Member Allocations & Resident Management */}
        <aside className="ledger-surface" aria-labelledby="members-heading">
          <div className="ledger-surface-header">
            <h2 id="members-heading" className="ledger-surface-title">
              Member Allocations
            </h2>
            <span className="badge badge-settled">
              {session.members.length} {session.members.length === 1 ? 'Resident' : 'Residents'}
            </span>
          </div>

          {/* Member Roster in insertion order */}
          {session.members.length === 0 ? (
            <div className="empty-members-box">
              <p>No residents enrolled yet.</p>
              <p style={{ marginTop: '4px', fontSize: '0.8125rem' }}>
                Add your household members below to establish the sharing roster.
              </p>
            </div>
          ) : (
            <ul className="member-list">
              {session.members.map((member) => {
                // Find authoritative balance if available
                const balanceEntry = session.cachedBalances?.find((b) => b.memberId === member.id)

                return (
                  <li key={member.id} className="member-row">
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
                      {session.cachedBalances === null ? (
                        <>
                          <div className="member-due-unavailable">Unavailable offline</div>
                          <div className="member-due-label">Offline</div>
                        </>
                      ) : balanceEntry !== undefined ? (
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
                {(pendingMember !== null || memberError.includes('Reconcile')) && (
                  <button
                    type="button"
                    className="member-reconcile-btn"
                    onClick={() => reconcileRoster()}
                    disabled={isReconciling}
                  >
                    {isReconciling ? 'Checking Server Roster...' : 'Reconcile with Server'}
                  </button>
                )}
              </div>
            )}
          </div>

          <div style={{ padding: '0 var(--space-6) var(--space-6)' }}>
            <div className="ledger-note-card">
              <div className="ledger-note-title">Ledger Protocol</div>
              Every entry divides evenly among active members with penny remainders distributed
              sequentially. Individual member shares remain marked pending until confirmed.
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}
