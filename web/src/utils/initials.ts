export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]
  if (!first) return '—'
  if (parts.length === 1) return first.slice(0, 2).toUpperCase()
  const last = parts[parts.length - 1]
  const firstInitial = first[0] ?? ''
  const lastInitial = last && last.length > 0 ? (last[0] ?? '') : ''
  return (firstInitial + lastInitial).toUpperCase()
}
