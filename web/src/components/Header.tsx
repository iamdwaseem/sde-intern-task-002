import { useHousehold } from '../context/HouseholdContext.tsx'

export function Header() {
  const { session, status } = useHousehold()
  const isOffline = status === 'api_unavailable'
  const isStale = status === 'stale'
  const isLoading = status === 'loading'
  const hasHousehold = Boolean(session?.home)

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
          {isLoading ? (
            <div className="household-pill loading" title="Restoring household ledger...">
              <span className="household-dot dot-pulsing" aria-hidden="true" />
              <span className="household-name">Connecting...</span>
            </div>
          ) : hasHousehold && session ? (
            <div
              className={`household-pill ${
                isOffline ? 'pill-offline' : isStale ? 'pill-stale' : 'pill-active'
              }`}
              title={
                isOffline
                  ? `Offline: Cached ledger for ${session.home.name}`
                  : isStale
                    ? `Stale: Balances could not be verified for ${session.home.name}`
                    : `Active Ledger: ${session.home.name}`
              }
            >
              <span
                className={`household-dot ${
                  isOffline ? 'dot-offline' : isStale ? 'dot-stale' : 'dot-online'
                }`}
                aria-hidden="true"
              />
              <span className="household-name">{session.home.name}</span>
              <span className="members-count-tag">
                {session.members.length} {session.members.length === 1 ? 'member' : 'members'}
              </span>
              {isOffline && <span className="offline-badge-pill">Offline</span>}
              {isStale && <span className="stale-badge-pill">Stale</span>}
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
