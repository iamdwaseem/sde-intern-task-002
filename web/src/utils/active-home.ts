const ACTIVE_HOME_KEY = 'bill_splitter_active_home'

export function loadActiveHomeId(): string | null {
  try {
    const value = localStorage.getItem(ACTIVE_HOME_KEY)
    return value && value.trim().length > 0 ? value.trim() : null
  } catch {
    return null
  }
}

export function saveActiveHomeId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_HOME_KEY, id)
  } catch {
    // ignore
  }
}

export function clearActiveHomeId(): void {
  try {
    localStorage.removeItem(ACTIVE_HOME_KEY)
  } catch {
    // ignore
  }
}
