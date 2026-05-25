# Billing — Stripe setup runbook

**Status as of 2026-05-24:** All code is in place (`api/billing/{checkout,portal,plans,webhook}.js`, `src/pages/settings/BillingSettings.jsx`, `src/components/billing/{PricingCards,UsageGate}.jsx`, migration 036). **Zero Stripe env vars are set in production.** Until you complete this runbook, the Billing settings page exists but no one can subscribe.

Pre-launch loose end #E (`/Users/qbook/.claude/projects/-Users-qbook-Claude-Projects-NarrateRx/memory/project_prelaunch_out_of_scope.md`). Run this when the first external tenant says yes.

---

## What's already wired

| Component | Where | Status |
|---|---|---|
| Plan catalog (Solo $149 / Practice $299 / Multi $499) | `api/billing/plans.js` | ✅ Reads `STRIPE_PRICE_*` env vars |
| Checkout session creation | `api/billing/checkout.js` | ✅ Posts to `/v1/checkout/sessions`, attaches `metadata.workspace_id` |
| Customer portal redirect | `api/billing/portal.js` | ✅ Creates portal session for self-service mgmt |
| Webhook handler | `api/billing/webhook.js` | ✅ HMAC-SHA256 sig verify; handles `checkout.session.completed`, `customer.subscription.{updated,deleted}` |
| Schema | Migration 036 | ✅ `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `plan_seats` on workspaces |
| Settings UI | `src/pages/settings/BillingSettings.jsx` + PricingCards | ✅ Admin-only, return-from-Stripe toasts wired |

---

## What you need to do

### 1. Stripe account

If you don't have one yet:
1. Sign up at https://dashboard.stripe.com/register with **drq@narraterx.ai** (or the operations alias if shared access).
2. Verify the account.
3. **Start in TEST MODE** for the first end-to-end verification — switch to live mode only after a clean test checkout.

Toggle test mode in the dashboard header (top right). Test mode and live mode have separate API keys + separate products.

### 2. Create the three products + prices

In Stripe Dashboard → **Products** → **+ Add product** (do this once in test mode, then again in live mode):

| Product name | Price | Billing | Notes |
|---|---|---|---|
| NarrateRx Solo | $149.00 USD | Monthly recurring | Up to 3 staff |
| NarrateRx Practice | $299.00 USD | Monthly recurring | Up to 10 staff |
| NarrateRx Multi-location | $499.00 USD | Monthly recurring | Unlimited |

After creating each product, **note the Price ID** (looks like `price_1QABcdef...`). You need three IDs total.

> **1Password storage** — save each ID with:
>
> | Field | Value |
> |---|---|
> | **Item type** | API Credential |
> | **Title** | `NarrateRx — STRIPE_PRICE_SOLO (test)` (one item per price, per mode) |
> | **Vault** | NarrateRx |
> | **Password / Value** | `price_xxxxxxxxxxxx` |
> | **Notes** | "Stripe Price ID for Solo plan, test mode. Used by `STRIPE_PRICE_SOLO` env var. Regenerate by editing the price in Stripe Dashboard → Products → Solo." |
>
> Sensitivity: **Mildly sensitive** (price IDs aren't secrets, but they're project-scoped identifiers worth tracking).

### 3. Get the secret API key

Stripe Dashboard → **Developers** → **API keys** → reveal **Secret key** (`sk_test_...` in test mode, `sk_live_...` in live mode).

Sensitivity: **Sensitive** — grants full Stripe account access. Save in 1Password:

| Field | Value |
|---|---|
| **Item type** | API Credential |
| **Title** | `NarrateRx — STRIPE_SECRET_KEY (test)` |
| **Vault** | NarrateRx |
| **Password / Value** | `sk_test_xxxxxxxxxxxx` |
| **Website** | https://dashboard.stripe.com/test/apikeys |
| **Notes** | "Stripe secret key, test mode. Used by `STRIPE_SECRET_KEY` env var on the narraterx Vercel project. Rotate by creating a new key in Stripe Dashboard → Developers → API keys and updating Vercel. The old key remains active until you click 'Roll' on it." |

### 4. Set env vars in Vercel

Run these from the project root. **The values are Sensitive — paste them in the Vercel CLI prompt, never in chat:**

```
cd "/Users/qbook/Claude Projects/NarrateRx" && vercel env add STRIPE_SECRET_KEY production preview
```

```
cd "/Users/qbook/Claude Projects/NarrateRx" && vercel env add STRIPE_PRICE_SOLO production preview
```

```
cd "/Users/qbook/Claude Projects/NarrateRx" && vercel env add STRIPE_PRICE_PRACTICE production preview
```

```
cd "/Users/qbook/Claude Projects/NarrateRx" && vercel env add STRIPE_PRICE_MULTI production preview
```

When the CLI prompts, mark each variable as **Sensitive** in the Vercel dashboard afterward (Project Settings → Environment Variables → click each → check Sensitive). Per `memory/feedback_vercel_sensitive_env_pull_empty.md`, this means `vercel env pull` will redact them locally — that's correct.

### 5. Create the webhook endpoint

Stripe Dashboard → **Developers** → **Webhooks** → **+ Add endpoint**:

| Field | Value |
|---|---|
| **Endpoint URL** | `https://narraterx.ai/api/billing/webhook` |
| **Events to send** | Select these three: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` |

After saving, click into the new endpoint → **Reveal signing secret** (`whsec_xxx`). Save in 1Password and add to Vercel:

```
cd "/Users/qbook/Claude Projects/NarrateRx" && vercel env add STRIPE_WEBHOOK_SECRET production preview
```

### 6. Redeploy

Env var changes need a fresh build to take effect:

```
cd "/Users/qbook/Claude Projects/NarrateRx" && npm run deploy:prod
```

### 7. End-to-end test (test mode)

1. Visit `https://movebetter-people.narraterx.ai/settings/workspace/billing` (signed in as an admin).
2. Pick a plan → Stripe Checkout opens.
3. Use Stripe's test card: `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
4. Complete checkout. You should be redirected back to `/settings/workspace/billing?billing=success`.
5. Verify in Supabase that `workspaces.stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, and `plan` are populated:
   ```sql
   SELECT slug, plan, stripe_customer_id, stripe_subscription_id, stripe_price_id
     FROM workspaces
     WHERE slug = 'movebetter-people';
   ```
6. Verify the webhook fired in Stripe Dashboard → Developers → Webhooks → click your endpoint → recent deliveries should show 200 OK.

### 8. Configure the customer portal

Stripe Dashboard → **Settings** → **Billing** → **Customer portal** → configure:
- ✅ Allow customers to update payment method
- ✅ Allow customers to view invoice history
- ✅ Allow customers to cancel subscriptions (with prompt for reason)
- ❌ Allow customers to switch plans (handle this through PricingCards instead, until plan-switching logic is verified)

Save. The portal is now usable from BillingSettings → Manage subscription button.

### 9. Promote to live mode

Once test mode works end-to-end:

1. Repeat steps 2 (create products), 3 (get key), 4 (set env vars) but in **live mode**.
2. The env var names stay the same — overwriting test values with live values.
3. Repeat step 5 (webhook endpoint) — Stripe requires a separate endpoint config for live mode. **Use the same URL** but it gets its own signing secret.
4. Update `STRIPE_WEBHOOK_SECRET` env var with the live secret.
5. Redeploy.
6. Real card transactions will now bill.

---

## Failure modes + diagnostics

| Symptom | Diagnose | Fix |
|---|---|---|
| BillingSettings shows "Workspace settings only available on a *.narraterx.ai deployment" | You're on the apex (`narraterx.ai`) instead of a workspace subdomain | Visit `https://<workspace-slug>.narraterx.ai/settings/workspace/billing` |
| Checkout returns 500 `billing-not-configured` | `STRIPE_SECRET_KEY` env var missing | Re-run step 4, redeploy |
| Pricing cards show plan info but "Subscribe" button missing | `STRIPE_PRICE_*` env vars missing | Re-run step 4 for the missing price IDs |
| Checkout succeeds but workspace row doesn't update | Webhook signature failed OR webhook endpoint URL wrong | Check Stripe Dashboard → Webhooks → recent deliveries. If 4xx/5xx, fetch `vercel logs --query "[billing/webhook]"` |
| Webhook fires but with "no matching workspace" error | Checkout session missing `metadata[workspace_id]` | Should not happen — `checkout.js` always sets it. If it does, regenerate checkout session |

---

## Cost note

Stripe takes **2.9% + $0.30 per transaction** (US standard rate). A $149/mo Solo subscription nets $144.38 after fees. A $299 Practice nets $290.04. No platform fees beyond that on standard accounts.

---

## What this runbook does NOT cover

- **Tax collection** — Stripe Tax automates this, but adds complexity. Defer until first non-US customer or until tax exposure matters.
- **Annual plan tiers** — current PRICES are all monthly. Add `STRIPE_PRICE_*_ANNUAL` vars + plan UI later.
- **Per-seat pricing** — `plan_seats` exists in the schema but isn't enforced. Add `UsageGate` checks at seat-creation points when needed.
- **Coupons / discounts** — add via Stripe Dashboard → Products → Coupons; Checkout sessions accept them with `discounts[0][coupon]`.
- **Failed-payment dunning** — Stripe handles retries automatically; the `customer.subscription.updated` webhook already updates workspace status when subscriptions go past_due → cancelled.

---

## Time estimate

- First-time test-mode setup: **45–60 min** (most of it is filling Stripe dashboard forms + waiting for verification)
- Promoting to live mode after test passes: **15 min**
- End-to-end test verification: **10 min**

---

_Last reviewed: 2026-05-24. Bump this date when you re-verify the runbook against Stripe's current dashboard UI._
