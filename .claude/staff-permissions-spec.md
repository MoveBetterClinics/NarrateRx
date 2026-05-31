# Spec: Per-person capability matrix

**Feature:** Per-staff capability overrides — a third resolution layer on top of tier defaults and workspace templates.

**Entry point:** `/settings/access` — a new settings page showing the full person × capability matrix. Replaces the current Clerk-delegated `/settings/members` for permissions management (Clerk's page still handles invites and org membership; this page handles what each person can actually do).

---

## Mental model — three-layer resolution

```
DEFAULT_TEMPLATES[tier]              ← baked in code (api/_lib/capabilities.js)
  + workspace.role_templates[tier]   ← admin overrides the whole tier for this workspace (migration 092)
    + staff.capability_overrides     ← NEW: per-person delta on top (migration 107)
      = effectiveCapabilities[]      ← what the person actually gets
```

`capability_overrides` is a jsonb map `{ [capId]: boolean }` — `true` = explicit grant (tier said no, person gets yes), `false` = explicit revoke (tier said yes, person gets no). Missing key = inherit from layer above. Owner-tier staff cannot have overrides; owner-only caps cannot be granted to non-owners.

---

## 1 · Database migration

**File:** `supabase/multitenant/migrations/107_staff_capability_overrides.sql`

```sql
-- Migration 107: per-staff capability overrides
-- Adds a jsonb column to the staff table so individual staff members can
-- receive custom grants/revocations on top of their permission_tier template.
--
-- Schema: { [capId]: boolean }
--   true  = explicit grant  (tier default was off, person gets on)
--   false = explicit revoke (tier default was on,  person gets off)
--   absent key = inherit from tier/workspace template
--
-- Constraints:
--   • Owner-tier staff rows must always have '{}' (enforced by the API, not DB).
--   • Only the 14 known capability IDs are valid keys (enforced by the API).
--   • Owner-only caps (settings.*, billing.*, members.invite) cannot be set
--     true for non-owner staff rows (enforced by the API).

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS capability_overrides jsonb NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.staff.capability_overrides IS
  'Per-person capability delta. Keys are cap IDs (see api/_lib/capabilities.js ALL_CAPABILITIES). '
  'true = explicit grant above tier default, false = explicit revoke. {} = pure tier default.';

-- Index on workspace_id already exists from the base table.
-- No additional index needed — this column is read per-row, never filtered on.
```

Apply before shipping any code that references `capability_overrides`:

```bash
cd "/Users/qbook/Claude Projects/NarrateRx" && node scripts/apply-multitenant-migrations.mjs supabase/multitenant/migrations/107_staff_capability_overrides.sql
```

---

## 2 · Server: `api/_lib/capabilities.js`

Two changes:

### 2a — Extend `resolveCapabilities` signature

```js
/**
 * Resolve the full capability set for a user in a workspace.
 *
 * @param {string} tier
 * @param {object} workspace
 * @param {object} [staffOverrides={}] — staff.capability_overrides jsonb
 * @returns {string[]}
 */
export function resolveCapabilities(tier, workspace, staffOverrides = {}) {
  const base = new Set(resolveTemplate(tier, workspace).capabilities)
  // Per-person deltas — true = grant, false = revoke
  for (const [cap, granted] of Object.entries(staffOverrides ?? {})) {
    if (!ALL_CAPABILITIES.includes(cap)) continue  // ignore unknown keys
    if (granted) base.add(cap)
    else base.delete(cap)
  }
  return [...base]
}
```

All existing callers pass only two args and keep working — `staffOverrides` defaults to `{}`.

### 2b — Export owner-only cap set (used by PATCH validation)

```js
// These capabilities can never be granted to non-owner staff rows.
// Enforced server-side in the PATCH /api/staff/:id/capabilities handler.
export const OWNER_ONLY_CAPABILITIES = new Set([
  CAP_SETTINGS_VIEW,
  CAP_SETTINGS_EDIT,
  CAP_BILLING_VIEW,
  CAP_BILLING_EDIT,
  CAP_MEMBERS_INVITE,
])
```

---

## 3 · Server: `api/workspace/me.js`

One-line change — pass `staff.capability_overrides` as the third arg.

**Current (line ~360):**
```js
current_user_capabilities = resolveCapabilities(current_user_tier, workspace)
```

**After:**
```js
current_user_capabilities = resolveCapabilities(
  current_user_tier,
  workspace,
  staffRow?.capability_overrides,   // staffRow is already in scope from the tier fetch above
)
```

Verify `staffRow` is in scope where this runs. If the staff row is fetched into a variable like `staff` or `staffRow` a few lines above the tier block, reference it there. If it's narrower scope, widen it or re-fetch `capability_overrides` in the same query.

---

## 4 · Server: `api/workspace/access-matrix.js` — NEW

`GET /api/workspace/access-matrix`

Returns all staff in the workspace with their resolved capabilities and raw overrides. Powers the matrix page.

```js
// runtime: 'nodejs'
import { getAuth } from '@clerk/backend'
import { workspaceContext } from './_lib/workspaceContext.js'
import { resolveCapabilities, CAP_MEMBERS_INVITE } from './_lib/capabilities.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = getAuth(req)
  if (!auth.userId) return res.status(401).json({ error: 'Unauthenticated' })

  const { workspace, staff: callerStaff } = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'Workspace not found' })

  // Gate: only users with members.invite can see the full matrix.
  // (Owner-only in default templates; workspace can lower this if they want.)
  const callerCaps = resolveCapabilities(
    callerStaff?.permission_tier,
    workspace,
    callerStaff?.capability_overrides,
  )
  if (!callerCaps.includes(CAP_MEMBERS_INVITE)) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }

  // Fetch all staff for this workspace.
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/staff?workspace_id=eq.${workspace.id}&select=id,name,legal_name,permission_tier,staff_type,capability_overrides,user_id,capture_upload_token,producer_onboarded_at`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  )
  if (!r.ok) return res.status(502).json({ error: 'Failed to load staff' })
  const staffRows = await r.json()

  // Also fetch pending Clerk invitations so unaccepted invites appear in the matrix.
  // (Clerk org membership list — HTTP API, not SDK, to avoid Edge import issues.)
  // Non-fatal: [] degrades gracefully.
  let pendingInvites = []
  try {
    const clerkResp = await fetch(
      `https://api.clerk.com/v1/organizations/${auth.orgId}/invitations?status=pending&limit=50`,
      { headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` } }
    )
    if (clerkResp.ok) {
      const body = await clerkResp.json()
      pendingInvites = (body.data ?? []).map(inv => ({
        id: `invite_${inv.id}`,
        name: inv.email_address,
        pending: true,
        email: inv.email_address,
        permission_tier: 'clinician',       // default tier for new invites
        staff_type: 'clinician',
        capability_overrides: {},
        resolved_capabilities: [],
      }))
    }
  } catch {}

  const rows = staffRows.map(s => ({
    ...s,
    pending: false,
    resolved_capabilities: resolveCapabilities(s.permission_tier, workspace, s.capability_overrides),
  }))

  return res.status(200).json({ staff: [...rows, ...pendingInvites], workspace_id: workspace.id })
}
```

---

## 5 · Server: `api/staff/[id]/capabilities.js` — NEW

`PATCH /api/staff/:id/capabilities`

Full-replace of a staff member's `capability_overrides`. The matrix page builds the full overrides object in memory and sends it on Save.

```js
// runtime: 'nodejs'
import { getAuth } from '@clerk/backend'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import {
  resolveCapabilities,
  ALL_CAPABILITIES,
  OWNER_ONLY_CAPABILITIES,
  CAP_MEMBERS_INVITE,
} from '../../_lib/capabilities.js'

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  const auth = getAuth(req)
  if (!auth.userId) return res.status(401).json({ error: 'Unauthenticated' })

  const { workspace, staff: callerStaff } = await workspaceContext(req)
  if (!workspace) return res.status(404).json({ error: 'Workspace not found' })

  // Gate: caller needs members.invite
  const callerCaps = resolveCapabilities(
    callerStaff?.permission_tier,
    workspace,
    callerStaff?.capability_overrides,
  )
  if (!callerCaps.includes(CAP_MEMBERS_INVITE)) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }

  // Parse target staff ID from URL
  const targetId = req.url.split('/').at(-2)  // /api/staff/:id/capabilities
  if (!targetId) return res.status(400).json({ error: 'Missing staff ID' })

  // Load target staff row — must be same workspace
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/staff?id=eq.${targetId}&workspace_id=eq.${workspace.id}&select=id,permission_tier,user_id`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  )
  if (!r.ok) return res.status(502).json({ error: 'DB error' })
  const [targetStaff] = await r.json()
  if (!targetStaff) return res.status(404).json({ error: 'Staff member not found' })

  // Guard: owner-tier staff cannot have overrides — they're always all-caps.
  if (targetStaff.permission_tier === 'owner') {
    return res.status(400).json({ error: 'Owner capabilities cannot be modified' })
  }

  // Guard: cannot modify your own capabilities.
  if (targetStaff.user_id === auth.userId) {
    return res.status(400).json({ error: 'Cannot modify your own capabilities' })
  }

  const { overrides } = req.body
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    return res.status(400).json({ error: 'overrides must be an object' })
  }

  // Validate all keys are known capability IDs, all values are boolean,
  // and no owner-only caps are being granted to a non-owner.
  for (const [cap, val] of Object.entries(overrides)) {
    if (!ALL_CAPABILITIES.includes(cap)) {
      return res.status(400).json({ error: `Unknown capability: ${cap}` })
    }
    if (typeof val !== 'boolean') {
      return res.status(400).json({ error: `Value for ${cap} must be boolean` })
    }
    if (val === true && OWNER_ONLY_CAPABILITIES.has(cap)) {
      return res.status(400).json({
        error: `${cap} is owner-only and cannot be granted to ${targetStaff.permission_tier}`,
      })
    }
  }

  // Write — full replace of capability_overrides
  const patch = await fetch(
    `${SUPABASE_URL}/rest/v1/staff?id=eq.${targetId}&workspace_id=eq.${workspace.id}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ capability_overrides: overrides }),
    }
  )
  if (!patch.ok) return res.status(502).json({ error: 'Failed to save' })

  return res.status(200).json({ ok: true, overrides })
}
```

**Vercel routing note:** Vercel's file-based routing won't auto-resolve `[id]` inside `api/staff/[id]/capabilities.js` as a segment — it treats the filename literally. Two clean options:

- **Option A (recommended):** `api/staff/capabilities.js` — take `id` from the request body or a query param (`?id=...`). No bracket routing needed, simpler file path.
- **Option B:** Add a `vercel.json` rewrite: `{ "source": "/api/staff/:id/capabilities", "destination": "/api/staff/capabilities?id=:id" }` — then read `req.query.id` in the handler.

Use Option A: the PATCH body already carries the staff ID, just lift it from there instead of the URL.

---

## 6 · Client: `src/pages/settings/AccessMatrix.jsx` — NEW

Core data flow:

```jsx
// Load matrix
const { data, isLoading } = useQuery({
  queryKey: ['access-matrix', workspaceId],
  queryFn: () => apiFetch('/api/workspace/access-matrix'),
})

// Save one person's overrides
const saveOverrides = useAppMutation(
  ({ staffId, overrides }) =>
    apiFetch('/api/staff/capabilities', {
      method: 'PATCH',
      body: JSON.stringify({ id: staffId, overrides }),
    }),
  {
    onSuccess: () => queryClient.invalidateQueries(['access-matrix']),
    successMessage: 'Permissions saved',
  }
)
```

**Local state pattern:** Hold a `localOverrides` map in `useState` — `{ [staffId]: { [capId]: boolean } }` — that starts from the server data and mutates on each cell click. The "Save changes" button sends the full local overrides for each dirty staff member. An "amber dot" on a cell means `localOverrides[staff.id]?.[cap] !== undefined`.

**Dirty-check:** Track `dirtyStaffIds: Set<string>`. A row is dirty when its local overrides differ from the server data for that staff member. Save button is disabled when the set is empty.

**Optimistic reset:** "Reset to tier default" for a person = set their local overrides to `{}` and mark dirty. "Restore all defaults" = clear all local overrides for all rows.

**Gate:** Render `null` (redirect to `/settings`) if `!has(CAP_MEMBERS_INVITE)` from `usePermission()`.

---

## 7 · Client: routing and nav

**`src/App.jsx`** — add inside the settings subroutes:
```jsx
<Route path="/settings/access" element={<AccessMatrix />} />
```

**`src/components/SettingsLayout.jsx`** — replace or augment the existing "Members & roles" entry:
```js
// Current:
{ to: '/settings/members', label: 'Members & roles', icon: Users }

// After (two items):
{ to: '/settings/members',  label: 'Members',         icon: Users   },  // Clerk invite/remove
{ to: '/settings/access',   label: 'Access matrix',   icon: Shield  },  // capability matrix (this feature)
```

Both stay in the same nav group. `/settings/members` keeps the Clerk `<OrganizationProfile />` for invites and org-level role; `/settings/access` is the new capability matrix.

---

## 8 · Edge cases & guard rails

| Case | Behavior |
|---|---|
| Owner-tier staff | 🔒 entire row — `resolveCapabilities` ignores `capability_overrides` for owners; PATCH returns 400 |
| Owner-only caps (settings.*, billing.*, members.invite) | Cannot be set `true` for non-owner staff — PATCH returns 400; UI shows 🔒 and cell is not clickable |
| Pending invite (no `user_id` yet) | Overrides can be stored on the staff row; they take effect on first session post-accept |
| Caller modifies their own row | PATCH returns 400 — prevents self-escalation |
| Unknown cap ID in PATCH body | PATCH returns 400 — forward-compat: client and server must share the same cap list |
| Workspace with no `role_templates` | Existing behavior — falls back to `DEFAULT_TEMPLATES`, unchanged |
| Tier change (staff.permission_tier updated separately) | `capability_overrides` is NOT auto-cleared — admin may want to keep grants. The matrix page shows the amber dot signaling "custom override active" so the admin can review |

---

## 9 · Definition of done

- [ ] Migration 107 applied to prod, `capability_overrides` column exists on `public.staff`
- [ ] `resolveCapabilities(tier, workspace, overrides)` passes existing unit test surface; `staffOverrides={}` produces identical output to before
- [ ] `GET /api/workspace/access-matrix` returns correctly for Move Better People workspace (Dr. Q, Cullen, Sophie, Maya, Philip)
- [ ] `PATCH /api/staff/capabilities` correctly validates and writes; owner-only cap grant returns 400; self-modification returns 400
- [ ] `api/workspace/me.js` passes `staffRow.capability_overrides` — Cullen's custom `content.publish` grant surfaces in `current_user_capabilities` when he visits
- [ ] Matrix page renders all 5 people, all 14 capabilities, correct initial state
- [ ] Cell toggle updates local state, amber dot appears, Save writes to API and clears dirty state
- [ ] "Reset to tier default" clears overrides for that person; "Restore all defaults" clears all
- [ ] Owner row is fully non-interactive; owner-only cap columns show 🔒 for non-owner rows
- [ ] `npm run typecheck`, `npm run lint`, `npm run build` all exit 0
- [ ] Feature verified in browser on Vercel preview URL

---

## Sequence

1. Write + apply migration 107
2. Extend `api/_lib/capabilities.js` (both changes — new `resolveCapabilities` sig + `OWNER_ONLY_CAPABILITIES`)
3. Update `api/workspace/me.js` (one line)
4. Write `api/workspace/access-matrix.js`
5. Write `api/staff/capabilities.js`
6. Write `src/pages/settings/AccessMatrix.jsx`
7. Update `src/App.jsx` + `src/components/SettingsLayout.jsx`
8. Smoke: load page on preview URL, toggle Cullen's publish cap, save, reload — verify persisted
