# Media Backup Runbook

Backups protect the Media Hub against three classes of disaster:

1. **Accidental deletion** — soft-delete (status=archived) is the first line of defense, see Layer 1. This runbook handles the case where soft-delete didn't catch it.
2. **Malicious deletion** — compromised admin or service-key incident.
3. **Provider failure** — Vercel Blob outage or data-loss event.

Two layers of backup, set up independently per brand:

| Layer       | Tool                              | Recovery window | Cost         |
|-------------|-----------------------------------|-----------------|--------------|
| Metadata    | Supabase Point-in-Time Recovery   | 7 days          | Pro plan: $25/mo per project |
| Blob files  | Backblaze B2 (weekly mirror)      | Forever         | ~$6/TB/mo    |

## One-time setup

### A. Backblaze B2 (single bucket, all brands)

Bucket layout: one bucket, brand-prefixed keys.
```
b2://movebetter-media-backup/
  people/
    manifest/<iso>.json
    blobs/media/raw/...
    rendered/<asset-id>/...
  equine/
    ...
  animals/
    ...
```

1. Create a Backblaze account at https://www.backblaze.com/b2/.
2. Create a bucket — call it `movebetter-media-backup`. Set it **Private** (NOT public).
3. Create an Application Key with **Read and Write** access to that bucket only.
4. Note the values — you'll add these as GitHub Actions secrets in section C.

| Value         | Where to find                          | Sensitivity         |
|---------------|----------------------------------------|---------------------|
| B2_KEY_ID     | "keyID" from app key dialog            | **Mildly sensitive** |
| B2_APP_KEY    | "applicationKey" from app key dialog   | **Sensitive**        |
| B2_BUCKET     | Bucket name                            | Not sensitive       |
| B2_ENDPOINT   | "Endpoint" on bucket page (e.g. https://s3.us-west-002.backblazeb2.com) | Not sensitive |
| B2_REGION     | The middle segment of the endpoint (e.g. `us-west-002`) | Not sensitive |

### B. Supabase Point-in-Time Recovery

Run **per brand** — each brand has its own Supabase project.

1. Open Supabase dashboard for the brand (e.g. NarrateRx People).
2. Navigate to **Settings → Add-ons → Point in Time Recovery**.
3. Upgrade the project to **Pro** if not already.
4. Enable PITR. Default 7-day retention is sufficient.
5. Verify a recent restore point appears within ~1 hour of enabling.

PITR cost: ~$25/month per project on top of Pro plan. Three brands ≈ $75/mo total.

If budget is a concern, enable PITR only on People for now (the brand with active Move Better content) and revisit before the other brands grow.

### C. GitHub Actions secrets

Set in **Settings → Secrets and variables → Actions** of `MoveBetterClinics/NarrateRx`.

Per-brand secrets:

| Secret name                  | Value                                      | Sensitivity       |
|------------------------------|--------------------------------------------|-------------------|
| `SUPABASE_URL_PEOPLE`        | https://<ref>.supabase.co                  | Mildly sensitive  |
| `SUPABASE_SERVICE_KEY_PEOPLE`| Service role key for People Supabase       | **Sensitive**     |
| `SUPABASE_URL_EQUINE`        | https://<ref>.supabase.co                  | Mildly sensitive  |
| `SUPABASE_SERVICE_KEY_EQUINE`| Service role key for Equine Supabase       | **Sensitive**     |
| `SUPABASE_URL_ANIMALS`       | https://<ref>.supabase.co                  | Mildly sensitive  |
| `SUPABASE_SERVICE_KEY_ANIMALS`| Service role key for Animals Supabase     | **Sensitive**     |

Shared B2 secrets:

| Secret name    | Sensitivity         |
|----------------|---------------------|
| `B2_KEY_ID`    | Mildly sensitive    |
| `B2_APP_KEY`   | **Sensitive**       |
| `B2_BUCKET`    | Not sensitive       |
| `B2_ENDPOINT`  | Not sensitive       |
| `B2_REGION`    | Not sensitive       |

### D. Verify

After secrets are configured, manually trigger one run to verify everything works:

```bash
gh workflow run backup-media.yml -R MoveBetterClinics/NarrateRx -f brand=people
```

Watch the run:

```bash
gh run watch -R MoveBetterClinics/NarrateRx
```

On success, log into Backblaze and confirm `people/manifest/<iso>.json` and `people/blobs/media/...` files appear.

## Routine operation

The workflow runs Sundays at 09:00 UTC (02:00 PT). It is idempotent — re-runs only copy net-new blobs.

Monitor via GitHub Actions. Failures will show up in the email digest if the user has Actions notifications enabled. Consider adding a Slack notification step if backup failures need faster surfacing.

## Recovery procedures

### Single asset deleted in error (within 30-day archive window)
Use the in-app **Restore** button on the archived row. No B2 recovery needed.

### Single asset purged in error (admin hard-delete)
1. Find the asset's `blob_pathname` from a recent manifest dump in B2.
2. Download the blob from `s3://movebetter-media-backup/<brand>/blobs/<pathname>`.
3. If Supabase still has a tombstone or PITR is within 7 days, restore the row via Supabase PITR. Otherwise, manually re-upload via the Media Hub UI.

### Whole-table loss
1. Restore Supabase via PITR to a point before the loss.
2. Verify rows reference still-present blobs in Vercel Blob. If blobs are also gone, restore them from B2 in parallel by iterating the most recent manifest:
   ```bash
   B2_BUCKET=movebetter-media-backup node scripts/restore-blob.mjs --brand=people --manifest=<iso>
   ```
   *(The restore script is a follow-up — write it when first needed; the manifest format is stable so it can be done at recovery time.)*

### Vercel Blob provider failure
1. Spin up a replacement blob store (or move to S3/B2 directly with a thin proxy).
2. Restore from the most recent manifest into the new store.
3. Update the `blob_url` column on each row to the new location.

## Cost projection

| Component | Cost                                             |
|-----------|--------------------------------------------------|
| B2 storage | ~$6/TB/mo. With ~50GB media → ~$0.30/mo. With 1TB → $6/mo. |
| B2 egress | Free up to 3× monthly storage (effectively free for backup-only use) |
| Supabase PITR | $25/mo per brand on Pro. Three brands = $75/mo. |
| GitHub Actions | Free for this workload (well under public-repo limits, and this is a private repo with included minutes) |

**Total: ~$75–100/mo all-in for catastrophic-loss insurance across all three brands.**

## What backup does NOT cover

- **Real-time deletes** between weekly runs. If something is deleted Monday morning, the only protection until Sunday is soft-delete + Supabase PITR.
- **Schema drift in Supabase.** If a migration drops or alters a column, the manifest reflects the post-change shape. Schema rollback is via PITR or `git revert` on the migration file.
- **Vercel-side metadata** (e.g. content-type headers set on the blob). The script captures `mime_type` from the row, which is the source of truth.
