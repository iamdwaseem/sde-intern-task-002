import { useHousehold } from '../context/HouseholdContext.tsx'

export function Header() {
  const { home, members, status } = useHousehold()
  const isLoading = status === 'loading'
  const hasHousehold = Boolean(home)

  return (
    <header className="app-header">
      <div className="header-container">
        <a href="/" className="brand-anchor" aria-label="Household Ledger Home">
          <div className="brand-symbol" aria-hidden="true">
            $
          </div>
          <div className="brand-text">
            <span className="brand-name">Household Ledger</span>
            <span className="brand-tagline">Shared Expense Accounting</span>
          </div>
        </a>

        <div className="household-context">
          {isLoading ? (
            <div className="household-pill loading" title="Restoring household ledger...">
              <span className="household-dot dot-pulsing" aria-hidden="true" />
              <span className="household-name">Connecting...</span>
            </div>
          ) : hasHousehold && home ? (
            <div className="household-pill pill-active" title={`Active Ledger: ${home.name}`}>
              <span className="household-dot dot-online" aria-hidden="true" />
              <span className="household-name">{home.name}</span>
              <span className="members-count-tag">
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </span>
            </div>
          ) : (
            <div className="household-pill pill-unconfigured" title="No household configured">
              <span className="household-dot dot-idle" aria-hidden="true" />
              <span className="household-name">No Active Home</span>
              <span className="members-count-tag">Setup Required</span>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
