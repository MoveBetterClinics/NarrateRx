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

const SIZE_CLASSES = {
  xs: 'h-5 w-5 text-3xs',
  sm: 'h-6 w-6 text-3xs',
  md: 'h-7 w-7 text-xs',
  lg: 'h-10 w-10 text-sm',
  xl: 'h-16 w-16 text-lg',
}

const NAME_SIZE_CLASSES = {
  xs: 'text-xs',
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
  xl: 'text-2xl font-bold',
}

/**
 * @param {{
 *   id?: string,
 *   name?: string,
 *   size?: 'xs'|'sm'|'md'|'lg'|'xl',
 *   className?: string,
 *   showName?: boolean,
 *   nameClassName?: string,
 * }} props
 */
export function ClinicianChip({
  id,
  name,
  size = 'md',
  className = '',
  showName = false,
  nameClassName = '',
}) {
  const colorClass = colorFor(id || name)
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md
  const displayName = name || 'Unknown clinician'

  const avatar = (
    <span
      title={name || id}
      className={`inline-flex items-center justify-center rounded-full font-semibold select-none shrink-0 ${sizeClass} ${colorClass} ${showName ? '' : className}`}
    >
      {getInitials(name)}
    </span>
  )

  if (!showName) return avatar

  const nameSizeClass = NAME_SIZE_CLASSES[size] ?? NAME_SIZE_CLASSES.md
  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      {avatar}
      <span className={`truncate ${nameSizeClass} ${nameClassName}`}>
        {displayName}
      </span>
    </span>
  )
}
