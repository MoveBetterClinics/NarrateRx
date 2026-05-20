// Reusable task-bucket card for the Home page.
// Props:
//   id           — string, used as the element id for ?bucket= deep-link scroll
//   title        — string, card header label
//   icon         — React node rendered next to the title
//   items        — array of data items
//   renderItem   — (item) => JSX, renders each row
//   emptyMessage — string shown when items is empty
//   footer       — optional React node rendered at the bottom of the card
//                   (e.g. a "See all →" link when the list is capped)
//   accent       — optional CSS color for the left rail next to the title.
//                  Defaults to the primary brand orange. The rail is the
//                  blend theme's hue-coded section navigation cue.
//   highlight    — when true, applies the warm "do this now" card surface
//                  (used for Awaiting review). Mutually exclusive with the
//                  default neutral card surface.
export default function TaskBucketCard({
  id,
  title,
  icon,
  items = [],
  renderItem,
  emptyMessage,
  footer,
  accent = 'hsl(var(--primary))',
  highlight = false,
}) {
  const surface = highlight
    ? 'rounded-2xl border border-[#f3d3b5] bg-gradient-to-b from-white to-[#fefaf7] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(227,101,37,0.22)]'
    : 'rounded-2xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]'
  return (
    <div id={id} className={surface}>
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <span
          className="inline-block w-1 h-6 rounded-full shrink-0"
          style={{ background: accent }}
          aria-hidden="true"
        />
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-lg font-bold tracking-tight flex-1">{title}</h2>
        {items.length > 0 && (
          <span
            className={
              highlight
                ? 'inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-primary text-primary-foreground text-2xs font-bold px-1.5'
                : 'inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-slate-100 text-slate-600 text-2xs font-bold px-1.5'
            }
          >
            {items.length}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item, i) => (
            // renderItem is responsible for the key on its root element; we wrap
            // in a li but pass the index as a fallback key at the li level only.
            <li key={i}>{renderItem(item)}</li>
          ))}
        </ul>
      )}
      {footer && items.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-2.5 text-right">{footer}</div>
      )}
    </div>
  )
}
