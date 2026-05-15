// Reusable task-bucket card for the Home page.
// Props:
//   id           — string, used as the element id for ?bucket= deep-link scroll
//   title        — string, card header label
//   icon         — React node rendered next to the title
//   items        — array of data items
//   renderItem   — (item) => JSX, renders each row
//   emptyMessage — string shown when items is empty
export default function TaskBucketCard({ id, title, icon, items = [], renderItem, emptyMessage }) {
  return (
    <div id={id} className="rounded-xl border bg-white shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-sm font-semibold flex-1">{title}</h2>
        {items.length > 0 && (
          <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-primary/10 text-primary text-[11px] font-semibold px-1.5">
            {items.length}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="divide-y">
          {items.map((item, i) => (
            // renderItem is responsible for the key on its root element; we wrap
            // in a li but pass the index as a fallback key at the li level only.
            <li key={i}>{renderItem(item)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
