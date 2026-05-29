# Book publish contract — `kind: 'book'`

`POST /api/book/publish` (NarrateRx side) extends the existing Astro+GitHub
publish lane with a new payload variant for the workspace book. Same auth,
same credential (`astro_github`), same receiver URL — but a different `kind`
that signals "overwrite a single canonical page" semantics rather than the
"never-overwrite, one-slug-per-post" blog semantics.

This document is the source of truth for receiver implementers (the Astro
sites at `movebetter.co` and `movebetteranimalchiro.com`). Update both sides
together — the NarrateRx side already detects out-of-date receivers and
surfaces a `receiver_out_of_date` error to the admin user, but that error is
a stopgap, not a feature.

## Why `kind` was added

The original blog contract (`api-publish-contract.md` in the receiving repo)
guarantees that a `slug` is **never overwritten** — slug collision returns
`409 slug_taken` so a typo can't clobber an existing post. The book is the
opposite shape: one canonical artifact per workspace, regenerated daily,
intentionally overwritten on every publish. We need a way for the receiver
to know which semantic the caller wants.

The `kind` field defaults to `'blog'` when absent, so callers older than
this contract continue to work unchanged.

## Payload — `kind: 'book'`

```json
{
  "kind":         "book",
  "slug":         "book",
  "title":        "Move Better Animals — Book",
  "description":  "A living manuscript woven from Move Better Animals's interviews and original work.",
  "pubDate":      "2026-05-25T17:42:00.000Z",
  "updatedDate":  "2026-05-25T17:42:00.000Z",
  "markdown":     "## Chapter one — …\n\n…full manuscript markdown…",
  "chapters": [
    { "slug": "chapter-one",   "title": "Chapter one — …" },
    { "slug": "chapter-two",   "title": "Chapter two — …" }
  ]
}
```

Field notes:

- **`kind`** — required. Must be the literal string `"book"`. Older receivers
  that don't understand this should return `400` with a message mentioning
  `kind` or `book` so the NarrateRx side can surface "receiver out of date."
- **`slug`** — always the literal string `"book"`. Reserved by the new
  contract for the book page; receivers MUST NOT route this to the blog
  content collection.
- **`markdown`** — the full manuscript. Heading levels start at `##`
  (chapters). `#` is reserved for the page title which the Astro template
  renders.
- **`chapters`** — table-of-contents data. Each entry's `slug` matches the
  `id` the receiver should put on the corresponding `<h2>` so anchor links
  work. Order is render order.
- **`pubDate` / `updatedDate`** — both default to the manuscript's
  `last_regen_at`. Receivers should expose `updatedDate` to readers as
  "Last updated …" on the rendered page.
- No `heroImage`, no `images[]`, no `tags`, no `draft` — none of these
  apply to the book in v1. Receivers should ignore any other fields they
  see for forward-compat.

## Receiver behavior

### 1. Auth

Identical to the blog flow: `Authorization: Bearer <shared-secret>` against
the same env var (`NARRATERX_PUBLISH_SECRET`).

### 2. File destination

Receivers commit the manuscript to a **single fixed file**. The NarrateRx
side does not care about the path — only that the rendered page lives at
`https://<site>/book`. The canonical destination is:

```
src/pages/book.astro
```

This makes the book a top-level Astro page with full layout control, not a
content-collection entry. The receiver builds the `.astro` file by
templating the payload (see "Page template" below) and commits it. Vercel
rebuilds the site on push.

If a receiver already has an unrelated `src/pages/book.astro`, choose a
different path internally and surface that in the receiver's `postUrl`
response — but `/book` on the public domain is strongly recommended.

### 3. Overwrite semantics

**The receiver MUST overwrite the destination file** on every successful
publish. No 409, no "slug taken" check, no rename suffixes. The commit
message should make the overwrite obvious, e.g.
`book: publish manuscript (<sha-of-markdown>:0:8)`.

### 4. Response

On success — `200 OK`:

```json
{
  "success":    true,
  "postUrl":    "https://movebetteranimalchiro.com/book",
  "commitUrl":  "https://github.com/Move-Better/movebetteranimal/commit/<sha>"
}
```

`postUrl` is required — the NarrateRx side shows it in the success toast so
the admin can click straight to the live page. If `postUrl` is omitted,
NarrateRx falls back to deriving it from the receiver URL
(`receiverUrl.replace(/\/api\/publish\/?$/, '/book')`), so omitting it is
non-fatal but rude.

`commitUrl` is optional but nice to have for audit trails.

Other status codes:

| Status | When |
|---|---|
| `400` | Payload invalid (missing fields, bad markdown, etc.). Include `message` describing the problem. |
| `400` | Receiver doesn't recognize `kind: 'book'` — message MUST mention `kind` or `book` so the NarrateRx side can return `receiver_out_of_date`. |
| `401` | Bearer secret mismatch. |
| `500` | Receiver is misconfigured (missing GitHub token, etc.). Not retriable from NarrateRx. |
| `502` | GitHub commit failed transiently. Safe to retry. |

## Page template — `src/pages/book.astro`

Receivers are free to design the page however they want. A reasonable
starting template:

```astro
---
import Layout from '../layouts/Layout.astro'
import { marked } from 'marked'

// Frontmatter injected by the receiver from the payload:
const title       = '<%= title %>'
const description = '<%= description %>'
const updatedDate = '<%= updatedDate %>'
const chapters    = <%= JSON.stringify(chapters) %>
const markdown    = `<%= markdown %>`

const html = marked.parse(markdown, { gfm: true, breaks: false })
const formattedDate = new Date(updatedDate).toLocaleDateString(undefined, {
  month: 'long', day: 'numeric', year: 'numeric',
})
---

<Layout title={title} description={description}>
  <main class="book">
    <header>
      <h1>{title}</h1>
      <p class="updated">Last updated {formattedDate}</p>
    </header>

    {chapters.length > 0 && (
      <nav class="toc" aria-label="Chapters">
        <h2>Chapters</h2>
        <ol>
          {chapters.map((c) => (
            <li><a href={`#${c.slug}`}>{c.title}</a></li>
          ))}
        </ol>
      </nav>
    )}

    <article class="manuscript" set:html={html} />
  </main>
</Layout>
```

The marked options match the NarrateRx side (`gfm: true, breaks: false`) so
the HTML output matches what admins see in the NarrateRx app.

**Anchor IDs:** the rendered `<h2>` elements need `id="<chapter-slug>"` for
the TOC links to work. Either pre-process the markdown to inject `{#slug}`
suffixes before marked sees it, or post-process the HTML to add the IDs by
matching heading text to `chapters[].title`. The exact approach is up to
the receiver.

## Backward compatibility

- Callers that send `kind: 'blog'` or omit `kind` continue to hit the blog
  content-collection path. No behavior change.
- Callers that send any other `kind` value SHOULD receive `400` with a
  message describing which `kind` values are accepted.

## Out of scope for v1

- WordPress receivers — equine is deferred. The NarrateRx side returns
  `501 wordpress_book_publish_not_implemented` if a workspace has WP creds.
- Per-chapter publish (one URL per chapter) — the book is currently a
  single page. If we want chapter pages later, that's a new `kind` or a
  separate endpoint.
- Inline images in the manuscript — book synthesis doesn't currently
  produce image references. If it starts to, we'll add an `images[]` field
  mirroring the blog contract.
- Drafts / scheduled publish — the book always overwrites the live page
  immediately. If we want a draft pipeline, add an explicit `draft: true`
  field and a separate `/book-preview` path on the receiver.
