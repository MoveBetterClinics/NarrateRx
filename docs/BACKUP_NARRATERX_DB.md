# Manual backup — shared `narraterx` Supabase

**There is no automatic backup.** PITR is not enabled. Supabase's free-tier daily snapshots cover the last 7 days but are not downloadable. Take a manual backup whenever you want a portable, vendor-neutral snapshot.

## Run a backup (one command)

From the repo root:

```
npm run backup:db
```

That's it. The script:
- Sources `.env.local` for `MULTITENANT_DATABASE_URL`
- Runs `pg_dump` on the `public` schema (skips Supabase-internal schemas you can't restore anyway)
- Gzips the output
- Writes to `~/Backups/narraterx-supabase/narraterx-<UTC-timestamp>.sql.gz`
- Prints the latest 5 backups + a reminder to copy off-machine

Takes ~30 seconds. Output file is ~1–10 MB compressed.

## Prerequisites (one-time)

If `pg_dump` isn't installed:

```
brew install libpq && brew link --force libpq
```

The repo's `.env.local` must contain `MULTITENANT_DATABASE_URL` (already there per project setup).

## What's in the backup

The full `public` schema of the shared `narraterx` Supabase project (`db.wrqfrjhevkbbheymzezy.supabase.co`):
- workspaces, workspace_credentials, workspace_locations
- clinicians, interviews, content_items, content_pieces
- media_assets, media_audit, collections, collection_items, clinic_settings

**`workspace_credentials` rows hold encrypted publish credentials** (Buffer / FB / GBP / etc.). The encryption key (`WORKSPACE_CREDENTIALS_KEY`) is **not** in the dump — keep both safe; you need both to restore.

**Vercel Blob media is NOT in the backup.** `media_assets` rows contain blob URLs; the actual binary files live in Vercel Blob and are backed up separately. See `docs/MEDIA_BACKUP_RUNBOOK.md` for that flow.

## Verify a backup

Quick row-count sanity check:

```
gunzip -c ~/Backups/narraterx-supabase/narraterx-<timestamp>.sql.gz | grep -E "^COPY public\." | head -20
```

You should see `COPY public.workspaces`, `COPY public.media_assets`, etc.

## Store off-machine

After taking a backup, copy to at least one off-machine location:

- **1Password Secure Note attachment** (if < 250 MB) — drag-drop the `.sql.gz` into a note titled `NarrateRx — DB snapshot YYYY-MM-DD`.
- **iCloud Drive / Dropbox / external SSD** — copy from `~/Backups/narraterx-supabase/`.

Don't push backups to the source repo (`.backups/` is gitignored for this reason).

## Restore (emergency — practice once before you need it)

**Test restore into a fresh local Postgres** first (never directly to prod):

```
createdb narraterx_restore_test && \
gunzip -c ~/Backups/narraterx-supabase/narraterx-<timestamp>.sql.gz | psql -d narraterx_restore_test && \
psql -d narraterx_restore_test -c "SELECT count(*) FROM workspaces; SELECT count(*) FROM media_assets;"
```

Counts should match the live DB at backup time.

**Restore into a NEW Supabase project** (vendor-exit or disaster recovery):

1. Create a new Supabase project, get its connection string.
2. `gunzip -c ~/Backups/narraterx-supabase/narraterx-<timestamp>.sql.gz | psql -d <new-conn-string>`
3. Re-run `supabase/multitenant/migrations/003_grant_service_role.sql` to ensure service_role grants apply.
4. Set `WORKSPACE_CREDENTIALS_KEY` env var on the new deployment (without it, `workspace_credentials` rows are unreadable).
5. Update `MULTITENANT_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` env vars on the `narraterx` Vercel project to point at the new project.

## When to take one

No automation. You decide. Recommended triggers:

- Before any raw-SQL migration that alters table structure
- Before bulk data operations (mass workspace creation/deletion, schema reshape)
- Before testing risky changes against prod
- Quarterly as a known-good archive
- Before any planned vendor migration
- After major content milestones if you want a known-good restore point

**Without PITR, "I deleted a row 30 minutes ago" cannot be recovered unless you took a backup before the delete.** Keep this in mind for risky operations.

## Retention guidance

- Keep last 4 manual snapshots locally (~1 month).
- Keep one snapshot per quarter indefinitely (in 1Password or cloud archive).
- Delete anything older than 1 year unless you have a compliance reason to keep it.
