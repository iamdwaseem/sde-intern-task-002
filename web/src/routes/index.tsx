import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HouseholdLedgerShell,
})

function HouseholdLedgerShell() {
  return (
    <main className="app-shell">
      {/* Editorial Page Header */}
      <section className="editorial-banner">
        <div className="editorial-header-left">
          <span className="editorial-eyebrow">Accounting Period</span>
          <h1 className="editorial-title">Household Expense Ledger</h1>
          <p className="editorial-description">
            Shared living expenses, municipal utilities, and domestic allocations divided equally
            across active residents.
          </p>
        </div>

        <div className="header-status-badge">
          <span className="status-indicator" aria-hidden="true" />
          <span className="status-label">Cycle:</span>
          <span className="status-period">November 2026</span>
        </div>
      </section>

      {/* Two-Column Responsive Ledger Composition */}
      <div className="ledger-layout">
        {/* Left Primary Column: Shared Expenses */}
        <section className="ledger-surface" aria-labelledby="bills-heading">
          <div className="ledger-surface-header">
            <h2 id="bills-heading" className="ledger-surface-title">
              Shared Bills & Expenditures
            </h2>
            <span className="ledger-surface-meta">3 recorded entries</span>
          </div>

          {/* Quick Metrics Strip */}
          <div className="stats-strip">
            <div className="stat-cell">
              <div className="stat-label">Total Incurred</div>
              <div className="stat-figure tabular-numbers">$465.00</div>
            </div>
            <div className="stat-cell">
              <div className="stat-label">Settled to Date</div>
              <div className="stat-figure tabular-numbers">$310.00</div>
            </div>
            <div className="stat-cell">
              <div className="stat-label">Pending Collection</div>
              <div className="stat-figure highlight tabular-numbers">$155.00</div>
            </div>
          </div>

          {/* Ledger Table */}
          <table className="ledger-table">
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col" className="bill-allocation-desktop">
                  Allocation
                </th>
                <th scope="col">Total</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div className="bill-item">
                    <span className="bill-title">Con Edison — Gas & Electric</span>
                    <div className="bill-submeta">
                      <span className="bill-date">Recorded Nov 2, 2026</span>
                      <span className="bill-allocation-mobile tabular-numbers">• 3 × $60.00</span>
                    </div>
                  </div>
                </td>
                <td className="bill-allocation-desktop">
                  <span className="tabular-numbers">3 × $60.00</span>
                </td>
                <td>
                  <span className="bill-amount tabular-numbers">$180.00</span>
                </td>
                <td>
                  <span className="badge badge-unsettled">1 Pending</span>
                </td>
              </tr>
              <tr>
                <td>
                  <div className="bill-item">
                    <span className="bill-title">Whole Foods — Household Provisions</span>
                    <div className="bill-submeta">
                      <span className="bill-date">Recorded Nov 4, 2026</span>
                      <span className="bill-allocation-mobile tabular-numbers">• 3 × $70.00</span>
                    </div>
                  </div>
                </td>
                <td className="bill-allocation-desktop">
                  <span className="tabular-numbers">3 × $70.00</span>
                </td>
                <td>
                  <span className="bill-amount tabular-numbers">$210.00</span>
                </td>
                <td>
                  <span className="badge badge-unsettled">1 Pending</span>
                </td>
              </tr>
              <tr>
                <td>
                  <div className="bill-item">
                    <span className="bill-title">Gigabit Fiber Internet</span>
                    <div className="bill-submeta">
                      <span className="bill-date">Recorded Nov 5, 2026</span>
                      <span className="bill-allocation-mobile tabular-numbers">• 3 × $25.00</span>
                    </div>
                  </div>
                </td>
                <td className="bill-allocation-desktop">
                  <span className="tabular-numbers">3 × $25.00</span>
                </td>
                <td>
                  <span className="bill-amount tabular-numbers">$75.00</span>
                </td>
                <td>
                  <span className="badge badge-unsettled">1 Pending</span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Interactive Action Demonstration */}
          <div
            style={{
              padding: 'var(--space-4) var(--space-6)',
              borderTop: '1px solid var(--color-border-subtle)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <button type="button" className="btn-action">
              Record Shared Bill
            </button>
          </div>
        </section>

        {/* Right Secondary Column: Member Allocations */}
        <aside className="ledger-surface" aria-labelledby="members-heading">
          <div className="ledger-surface-header">
            <h2 id="members-heading" className="ledger-surface-title">
              Member Allocations
            </h2>
            <span className="badge badge-settled">3 Residents</span>
          </div>

          <ul className="member-list">
            <li className="member-row">
              <div className="member-profile">
                <div className="member-avatar" aria-hidden="true">
                  JV
                </div>
                <div>
                  <div className="member-name">Julian Vance</div>
                  <div className="member-role">Resident</div>
                </div>
              </div>
              <div className="member-due">
                <div className="member-due-amount owes tabular-numbers">$85.00</div>
                <div className="member-due-label">Outstanding</div>
              </div>
            </li>
            <li className="member-row">
              <div className="member-profile">
                <div className="member-avatar" aria-hidden="true">
                  ER
                </div>
                <div>
                  <div className="member-name">Elena Rostova</div>
                  <div className="member-role">Resident</div>
                </div>
              </div>
              <div className="member-due">
                <div className="member-due-amount owes tabular-numbers">$70.00</div>
                <div className="member-due-label">Outstanding</div>
              </div>
            </li>
            <li className="member-row">
              <div className="member-profile">
                <div className="member-avatar" aria-hidden="true">
                  MC
                </div>
                <div>
                  <div className="member-name">Marcus Chen</div>
                  <div className="member-role">Resident</div>
                </div>
              </div>
              <div className="member-due">
                <div className="member-due-amount cleared tabular-numbers">$0.00</div>
                <div className="member-due-label">Settled</div>
              </div>
            </li>
          </ul>

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
