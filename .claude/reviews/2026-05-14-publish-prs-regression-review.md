# Regression review — PR #430 + PR #438 (publish flow)

**Reviewer:** Claude (overnight code-level review, no live browser exercise)
**Scope:** [PR #430](https://github.com/Move-Better/NarrateRx/pull/430) (enrich blog payload + capture live URL) and [PR #438](https://github.com/Move-Better/NarrateRx/pull/438) (mirror blog images on publish). Both merged to `main`.

## TL;DR

Both PRs are well-scoped and the changes are coherent. **One real regression risk** worth a smoke test (PR #438), plus two soft-edges worth knowing about. Nothing that should hold the merges back.

## PR #430 — enrich blog payload + capture live URL

### Findings
- **Wire-up to `api/db/content.js` is complete.** The new payload fields `resolvedUrl` and `publishedAt` from `useUpdateContentItemStatus` are accepted at [api/db/content.js:147,151](api/db/content.js:147) and map cleanly to `published_at` / `resolved_url` columns. No silent drop.
- **"View live post" link condition is correct.** Only renders when `status === 'published' && platform === 'blog' && resolved_url` — defensive on all three.
- **Fail-soft on missing postUrl.** If the publish webhook returns no `postUrl`, `result.postUrl` is undefined → `resolvedUrl: undefined` → the conditional in `queries.js` skips the field → DB write succeeds without the column. Safe.

### Soft-edges (not regressions, just worth knowing)
- **Topic kebab-case strips unicode.** `piece.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')` would turn "Chronic Pain — Hüft" into "chronic-pain-h-ft". Topics with accented characters or non-Latin scripts will normalize to ASCII-with-gaps. Acceptable today (all three live workspaces use English topics), but tenant onboarding to non-English markets would need a slug helper that transliterates.
- **`piece.clinician_name` source assumption.** PR sends `author` from `piece.clinician_name`. Column exists in [api/db/content.js:41](api/db/content.js:41) `SELECT`, so reads are fine. Worth verifying inserts populate it for all current publish paths — if any newer interview path bypassed setting it, those rows would publish without an author.

### Smoke checklist (when you're back)
- [ ] Publish a blog from a People interview → confirm `content_items.resolved_url` is set on the row and the "View live post" link renders in the workbench.
- [ ] Confirm the post appears at `Move-Better/Movebetterco/src/content/blog/<slug>.md` with `author`, `topic`, `heroImage` frontmatter.

---

## PR #438 — mirror blog images on publish

### 🚨 Regression risk worth a smoke test

**WP inline-image upload failures now hard-fail the entire publish.** [api/publish/website.js](api/publish/website.js) in the new loop:

```js
for (const img of payload.images) {
  if (!img?.url || img.mirrorable === false) continue
  try {
    const wpMediaUrl = await uploadMediaForRewrite(wp, img.url, img.alt)
    if (wpMediaUrl) urlMap[img.url] = wpMediaUrl
  } catch (e) {
    return res.status(502).json({ error: 'media_upload_failed', message: `Inline image upload failed for ${img.url}: ${e.message}` })
  }
}
```

- **Before:** WP publish succeeded even with broken inline images — the post landed with hotlinks to NarrateRx blob storage.
- **After:** Any single inline image failing to upload to `/wp/v2/media` short-circuits the whole publish with 502. No WP post created.

This is defensible (avoids partial-mirror posts where half the images are mirrored and half are hotlinked) but it's a behavior change. Transient WP errors that previously didn't matter now block publishing.

**Specific smoke target:** publish an Equine post that has 2+ inline body images and confirm both upload successfully. Bonus: temporarily point one image to a 404 URL and confirm the failure surfaces with a useful toast.

### Other findings
- **`uploadMedia` return-shape change has no missed callers.** Before: returned the media `id` int. After: returns `{ id, source_url }`. Grep confirms exactly two callers in `website.js` — both updated correctly. No collateral.
- **Client/server `buildImagesManifest` parity is enforced by unit test** ([tests/lib/publishImageMirror.test.js](tests/lib/publishImageMirror.test.js)) — good defensive measure given the duplicate-source-of-truth pattern.
- **`isMirrorableUrl` whitelist is correct** for the three URL shapes that currently produce blob references (`*.public.blob.vercel-storage.com`, `*.blob.vercel-storage.com`, `*.narraterx.ai/...`). External CDNs (e.g. unsplash) correctly fall through as `mirrorable: false` and stay as hotlinks.
- **Astro path is forward-compatible.** Old receivers in movebetteranimal/movebetterpeople ignore the unknown `images[]` field; images stay as hotlinks until each receiver repo lands its own commit-bytes PR. **No regression there**, just a deferred opportunity — the dependency on NarrateRx blob storage isn't severed for Astro tenants until those receiver PRs ship.

### Smoke checklist (when you're back)
- [ ] **Equine WP publish with 2+ inline body images** — confirm both upload to `/wp/v2/media` and the rendered post on the live site references WP-hosted URLs (not NarrateRx blob URLs).
- [ ] **Equine WP publish where one image is broken/404** — confirm the 502 surfaces cleanly in the workbench toast (not a generic "Database error").
- [ ] **Animals/People Astro publish** — confirm publish still succeeds and the post renders (with hotlinked images, which is expected until the receiver PR ships).

---

## Cross-PR interaction

Both PRs touch the same `ApprovalPanel` block in [AssetsPane.jsx](src/components/story-detail/AssetsPane.jsx). They were merged in sequence (#438 first, then #430 built on it). Combined effect per blog publish:

1. Build images manifest (#438)
2. Add author/topic to payload (#430)
3. POST to website webhook
4. PATCH content_items.resolved_url + published_at (#430)
5. Render "View live post" link in workbench (#430)

Steps 1–3 happen in one publish call; steps 4–5 happen after. If step 3 fails (502 from new image-mirror cascade), step 4 never runs and `resolved_url` stays NULL. That's correct behavior.

---

## Action items (none blocking)

1. **Smoke the WP image-mirror failure mode** — first Equine publish after merge with 2+ inline images is the validation moment.
2. **Open the receiver-side image-commit PRs** in `movebetteranimal` and `movebetterpeople` repos to make Astro mirroring actually mirror (currently a no-op for them — they receive the manifest but don't act on it).
3. **Consider a slug-transliteration helper** if non-English tenant onboarding ever lands on the roadmap. Not urgent today.
