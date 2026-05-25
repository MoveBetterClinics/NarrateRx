# Author Corpus Ingestion Inbox

Drop your own writing here and run the loader script to push it into the
Author Mode retrieval corpus (movebetter-people workspace, Q's clinician).

## File formats accepted

- `.md`   — Markdown (frontmatter optional, stripped before indexing)
- `.txt`  — Plain text

## Frontmatter (optional, Markdown only)

Add YAML frontmatter at the top of any `.md` file to control how it's indexed:

```yaml
---
title: "Why I Became a Chiropractor"
docType: original_blog          # original_blog | uploaded_draft  (default: uploaded_draft)
sourceUrl: https://movebetter.co/blog/why-chiro
docDate: 2023-04-15
---
```

If `title` is omitted, the filename (without extension) is used as the title.
If `docType` is omitted, defaults to `uploaded_draft`.

## Loading

From the project root:

```
node scripts/ingest-inbox.mjs
```

Add `--dry-run` to see what would be sent without actually indexing.
Files are idempotent — re-running re-indexes any that changed.

## After loading

Run `node scripts/ingest-inbox.mjs --status` to see how many chunks each
document produced and when it was last indexed.
