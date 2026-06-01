// Post-deploy smoke for the Stories (Content Hub) pages.
//
// Catches three regression classes seen in the 2026-05-14 bug triage:
//
//   (a) Stories list 403 / workspace-not-resolved — workspace_id not threaded
//       through the stories/content-items endpoints. Symptom: spinner, then
//       "Forbidden" or a blank list that never resolves.
//
//   (b) Pipeline card links pointing to `/stories/undefined` — happens when a
//       content piece's `interview_id` is null and the ternary in PipelineKanban
//       produced `/review/${item.id}` which then redirected to `/stories/${itemId}`
//       using the piece ID (not the story/interview ID). Result: "Story not found."
//
//   (c) Story detail auth error — JWT missing org_id causes /api/db/interviews
//       or /api/db/content to return 403, leaving the detail page stuck in a
//       spinner or rendering a generic "Story not found."
//
// Data-conditional tests degrade gracefully: if prod has no stories yet, the
// assertions around card clicks and pipeline links don't run — they log a skip
// note instead of failing. Tests never mutate prod data.

import { test, expect } from '@playwright/test'

// ── 1. Stories list loads without auth error ────────────────────────────────

test('stories list loads without auth or workspace error', async ({ page }) => {
  await page.goto('/stories')

  // The heading is the first thing that renders once OrgGate admits the user
  // and the workspace is resolved. If we're stuck on 403 or workspace-not-found
  // the heading never appears.
  await expect(
    page.getByRole('heading', { name: /^stories$/i }),
  ).toBeVisible({ timeout: 30_000 })

  // No 403/forbidden/workspace-resolution error banner should appear.
  await expect(
    page.locator('text=/forbidden|403|workspace not resolved|network error/i'),
  ).toHaveCount(0, { timeout: 5_000 })
})

// ── 2. Pipeline cards never link to /stories/undefined ─────────────────────

test('pipeline card links contain valid UUIDs, not /undefined or /null', async ({ page }) => {
  // The Pipeline / Calendar / Themes lenses moved from Stories to the
  // clinic-wide Overview board (pipeline UX redesign, Phase 5). The
  // PipelineKanban link-generation guarded here now lives on /overview, which
  // is role-gated to editors — the e2e fixture is an admin, so it renders.
  await page.goto('/overview?view=pipeline')

  // Pipeline view renders the kanban. Give it time to load.
  await expect(
    page.getByRole('heading', { name: /^overview$/i }),
  ).toBeVisible({ timeout: 30_000 })

  // Collect all anchor hrefs on the page.
  const links = await page.$$eval('a[href]', (els: Element[]) =>
    els.map((el) => (el as HTMLAnchorElement).getAttribute('href') || ''),
  )

  // None should route to /stories/undefined or /stories/null.
  const brokenLinks = links.filter(
    (href) =>
      /\/stories\/(undefined|null)/.test(href) ||
      /\/review\/(undefined|null)/.test(href),
  )
  expect(
    brokenLinks,
    `Found broken story links (interview_id was null/undefined): ${brokenLinks.join(', ')}`,
  ).toHaveLength(0)
})

// ── 3. Story detail loads correctly (data-conditional) ─────────────────────

test('clicking a story card navigates to a valid story detail page', async ({ page }) => {
  // Stories is cards-only now (the Pipeline/Calendar/Themes toggle moved to
  // Overview in the pipeline UX redesign), so the list always renders
  // /stories/<interview-id> story-card links.
  await page.goto('/stories')
  await expect(
    page.getByRole('heading', { name: /^stories$/i }),
  ).toBeVisible({ timeout: 30_000 })

  // Find story card links — each StoryCard is a <Link to="/stories/:id">
  // wrapping the whole card. Use count() so an empty workspace skips
  // cleanly instead of hanging .first().getAttribute() until the test-level
  // timeout fires.
  const storyCardLinks = page.locator('a[href^="/stories/"]')
  if ((await storyCardLinks.count()) === 0) {
    console.log('[content-hub] No story cards found in prod — skipping navigation check.')
    return
  }
  const storyCardLink = storyCardLinks.first()
  const href = await storyCardLink.getAttribute('href')
  if (!href) {
    console.log('[content-hub] First story card had no href — skipping navigation check.')
    return
  }

  // The href must match /stories/<uuid>, not /stories/undefined.
  expect(href, 'Story card href should be a UUID path').toMatch(
    /^\/stories\/[0-9a-f-]{36}$/i,
  )

  await storyCardLink.click()

  // URL must have updated to the story detail path.
  await expect(page).toHaveURL(/\/stories\/[0-9a-f-]{36}/i, { timeout: 15_000 })

  // "Story not found" must NOT appear — that indicates the ID resolved to
  // nothing in the DB (e.g. piece ID used instead of interview ID).
  await expect(
    page.locator('text=/story not found/i'),
  ).toHaveCount(0, { timeout: 10_000 })

  // The story detail heading or the back link should be visible once loaded.
  await expect(
    page.getByRole('link', { name: /back to stories/i })
      .or(page.locator('h1'))
      .first(),
  ).toBeVisible({ timeout: 20_000 })
})

// ── 4. Story detail content pieces render without auth error (data-conditional)

test('story detail renders content pieces without auth error', async ({ page }) => {
  // Stories is cards-only now — see test 3.
  await page.goto('/stories')
  await expect(
    page.getByRole('heading', { name: /^stories$/i }),
  ).toBeVisible({ timeout: 30_000 })

  const storyCardLinks = page.locator('a[href^="/stories/"]')
  if ((await storyCardLinks.count()) === 0) {
    console.log('[content-hub] No story cards found — skipping content-pieces check.')
    return
  }
  const href = await storyCardLinks.first().getAttribute('href')
  if (!href) {
    console.log('[content-hub] First story card had no href — skipping content-pieces check.')
    return
  }

  await page.goto(href)
  await expect(page).toHaveURL(/\/stories\/[0-9a-f-]{36}/i, { timeout: 15_000 })

  // Story detail renders a two-column layout: TranscriptPane (left) and
  // AssetsPane (right). AssetsPane shows content pieces or an empty state.
  // An auth error from /api/db/content returns 403, which causes the pane
  // to render a network-error message instead of pieces.
  await expect(
    page.locator('text=/network error|forbidden|403/i'),
  ).toHaveCount(0, { timeout: 10_000 })

  // Either some content pieces OR the empty state must be present —
  // "Generating" spinner counts as "present" while AI runs.
  await expect(
    page
      .locator('[data-testid="assets-pane"]')
      .or(page.locator('text=/no content pieces|generating/i'))
      .or(page.locator('button', { hasText: /regenerate|approve|send for review/i }))
      .first(),
  ).toBeVisible({ timeout: 20_000 })
})
