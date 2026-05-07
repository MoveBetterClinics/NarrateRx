import { handleUpload } from '@vercel/blob/client'

// Client-direct upload to Vercel Blob using a token issued by this endpoint.
//
// Flow:
//   1. Browser calls upload() from '@vercel/blob/client' against this URL.
//   2. handleUpload first POSTs { type:'blob.generate-client-token', payload:{ pathname, clientPayload } }.
//      onBeforeGenerateToken returns the allowed mime types + clientPayload echoed back later.
//   3. Browser uploads file directly to Vercel Blob.
//   4. Blob calls back here with { type:'blob.upload-completed', payload:{ blob, tokenPayload } }.
//      onUploadCompleted writes the row to media_assets.

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function brandId() {
  return (process.env.BRAND || process.env.VITE_BRAND || 'people').toLowerCase()
}

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const err = (msg, status = 400)  => new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })

const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
]

function kindFromMime(mime) {
  if (!mime) return null
  if (mime.startsWith('image/')) return 'photo'
  if (mime.startsWith('video/')) return 'video'
  return null
}

export default async function handler(req) {
  if (req.method !== 'POST') return err('Method not allowed', 405)

  const body = await req.json()

  try {
    const result = await handleUpload({
      body,
      request: req,

      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // clientPayload is a JSON string the browser opted into sending.
        let meta = {}
        try { meta = clientPayload ? JSON.parse(clientPayload) : {} } catch {}

        return {
          allowedContentTypes: ALLOWED_MIME,
          // Round up to a generous ceiling — Blob enforces account limits anyway.
          maximumSizeInBytes: 500 * 1024 * 1024,
          // tokenPayload is echoed back to onUploadCompleted as a string.
          tokenPayload: JSON.stringify({
            brand: brandId(),
            filename: meta.filename || pathname.split('/').pop(),
            createdBy: meta.createdBy || null,
            patientPseudonym: meta.patientPseudonym || null,
            condition: meta.condition || null,
            capturedAt: meta.capturedAt || null,
            notes: meta.notes || null,
          }),
        }
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let meta = {}
        try { meta = tokenPayload ? JSON.parse(tokenPayload) : {} } catch {}

        const kind = kindFromMime(blob.contentType)
        if (!kind) return  // unknown type → don't record

        const row = {
          brand: meta.brand || brandId(),
          kind,
          status: 'raw',
          source: 'upload',
          blob_url: blob.url,
          blob_pathname: blob.pathname,
          filename: meta.filename || blob.pathname.split('/').pop(),
          mime_type: blob.contentType,
          size_bytes: blob.size || null,
          patient_pseudonym: meta.patientPseudonym || null,
          condition: meta.condition || null,
          captured_at: meta.capturedAt || null,
          notes: meta.notes || null,
          created_by: meta.createdBy || null,
        }

        const res = await sb('media_assets', { method: 'POST', body: JSON.stringify(row) })
        if (!res.ok) {
          // Blob is already uploaded — log but don't throw, otherwise the
          // browser sees a successful upload that didn't get recorded.
          console.error('media_assets insert failed:', res.status, await res.text())
        }
      },
    })

    return ok(result)
  } catch (e) {
    return err(e.message || 'Upload handler failed', 400)
  }
}
