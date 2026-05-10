// AES-256-GCM encryption for workspace_credentials.secret_ciphertext.
//
// Output format: base64( iv (12B) || ciphertext || authTag (16B) ). Single
// blob — no separate IV column. This matches the typical "envelope" pattern
// for one-key symmetric crypto.
//
// Master key: WORKSPACE_CREDENTIALS_KEY env var, 64 hex chars (32 bytes).
// Generate once with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// Set on the shared narraterx Vercel project as Sensitive. Losing this key
// makes existing encrypted credentials unrecoverable — re-paste required.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function getKey() {
  const hex = process.env.WORKSPACE_CREDENTIALS_KEY
  if (!hex) throw new Error('WORKSPACE_CREDENTIALS_KEY not set')
  if (hex.length !== 64) throw new Error('WORKSPACE_CREDENTIALS_KEY must be 64 hex chars (32 bytes)')
  return Buffer.from(hex, 'hex')
}

export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string') throw new TypeError('plaintext must be a string')
  const key = getKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, ciphertext, tag]).toString('base64')
}

export function decryptSecret(blob) {
  if (typeof blob !== 'string' || !blob) throw new TypeError('blob must be a non-empty string')
  const key = getKey()
  const buf = Buffer.from(blob, 'base64')
  if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('ciphertext too short')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(buf.length - TAG_LEN)
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
