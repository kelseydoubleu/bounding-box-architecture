-- ============================================================
-- Migration: add collaborative editing of existing entries
-- Run this ONCE in the Supabase SQL editor (your database already exists).
-- Safe to re-run (uses IF NOT EXISTS / drops policies first).
-- ============================================================

-- 1. Two new columns: who last edited a contribution, and when
alter table contributions add column if not exists last_edited_by text;
alter table contributions add column if not exists last_edited_at timestamptz;

-- 2. Open collaborative editing: anyone may UPDATE and DELETE.
--    (Prototype setting. Tighten to require auth before any real public launch.)
drop policy if exists "update contributions" on contributions;
drop policy if exists "delete contributions" on contributions;
drop policy if exists "update annotations" on annotations;
drop policy if exists "delete annotations" on annotations;
drop policy if exists "delete classifier_items" on classifier_items;

create policy "update contributions" on contributions for update using (true) with check (true);
create policy "delete contributions" on contributions for delete using (true);
create policy "update annotations" on annotations for update using (true) with check (true);
create policy "delete annotations" on annotations for delete using (true);
create policy "delete classifier_items" on classifier_items for delete using (true);

-- 3. Allow deleting image files from storage when a contribution is deleted
drop policy if exists "delete images" on storage.objects;
create policy "delete images" on storage.objects for delete using (bucket_id = 'images');
