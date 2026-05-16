// Consistent circular avatar for a clinician — initials + deterministic color
// derived from their ID. Same clinician always renders the same color across
// Themes, Stories Cards, Story Detail, Approval, and Clinician Profile.

const CHIP_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-sky-100 text-sky-700',
]

function colorFor(seed) {
  const hash = [...String(seed || '')].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return CHIP_COLORS[hash % CHIP_COLORS.length]
}

function getInitials(name) {
  return (name || '?')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?'
}

/**
 * @param {{ id?: string, name?: string, size?: 'sm'|'md', className?: string }} props
 */
export function ClinicianChip({ id, name, size = 'md', className = '' }) {
  const colorClass = colorFor(id || name)
  const sizeClass = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-xs'
  return (
    <span
      title={name || id}
      className={`inline-flex items-center justify-center rounded-full font-semibold select-none ${sizeClass} ${colorClass} ${className}`}
    >
      {getInitials(name)}
    </span>
  )
}
