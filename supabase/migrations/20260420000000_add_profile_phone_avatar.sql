-- ============================================================
-- Migration: add phone, avatar_url (if not exists), last_sign_in_at to profiles
-- ============================================================

-- phone column
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- avatar_url already exists in the table, but ensure it:
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- last_sign_in_at for informational use
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;

-- ── Storage bucket for avatars ────────────────────────────────────────────────
-- Run this in the Supabase SQL Editor (requires service_role):
--
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('avatars', 'avatars', true)
-- ON CONFLICT (id) DO NOTHING;
--
-- Or create it via the Supabase Dashboard:
--   Storage → New bucket → Name: "avatars" → Public: ON

-- ── Storage RLS policies for avatars ─────────────────────────────────────────
-- Allow authenticated users to upload their own avatar:
--
-- CREATE POLICY "Users can upload own avatar"
-- ON storage.objects FOR INSERT
-- TO authenticated
-- WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
--
-- Allow authenticated users to update their own avatar:
--
-- CREATE POLICY "Users can update own avatar"
-- ON storage.objects FOR UPDATE
-- TO authenticated
-- USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
--
-- Allow public read of avatars (bucket is public, so this is automatic):
-- No additional policy needed for public read on a public bucket.
