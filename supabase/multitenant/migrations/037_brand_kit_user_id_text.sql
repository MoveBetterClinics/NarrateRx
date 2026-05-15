-- Fix: brand_assets.uploaded_by and brand_kit_roles.assigned_by were typed
-- as uuid, but Clerk user IDs are text (e.g. user_2XHZJwXXXX). Every other
-- table in this schema uses text for Clerk user ID columns. The uuid type
-- causes PostgREST to reject inserts with a type-cast error, which prevented
-- role assignments from saving (code 22P02 or similar invalid uuid input).

alter table public.brand_assets
  alter column uploaded_by type text using uploaded_by::text;

alter table public.brand_kit_roles
  alter column assigned_by type text using assigned_by::text;
