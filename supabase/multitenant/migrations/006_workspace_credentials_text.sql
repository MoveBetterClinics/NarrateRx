-- Switch workspace_credentials.secret_encrypted from bytea (pgcrypto-blob)
-- to text (base64-encoded AES-256-GCM ciphertext). Encryption now happens
-- in Node using WORKSPACE_CREDENTIALS_KEY env (32-byte hex), keeping the
-- database engine ignorant of plaintext at all times.
--
-- Safe to run on the shared narraterx Supabase: workspace_credentials is
-- empty until Phase 1E seeds Move Better's tokens.

alter table workspace_credentials
  drop column secret_encrypted;

alter table workspace_credentials
  add column secret_ciphertext text;
