export function Header() {
  return (
    <header className="app-header">
      <div className="header-container">
        <a href="/" className="brand-anchor" aria-label="Household Ledger Home">
          <div className="brand-symbol" aria-hidden="true">
            §
          </div>
          <div className="brand-text">
            <span className="brand-name">Household Ledger</span>
            <span className="brand-tagline">Shared Expense Accounting</span>
          </div>
        </a>

        <div className="household-context">
          <div className="household-pill" title="Active Household">
            <span className="household-dot" aria-hidden="true" />
            <span className="household-name">74 Waverly Place</span>
            <span className="members-count-tag">3 members</span>
          </div>
        </div>
      </div>
    </header>
  )
}
