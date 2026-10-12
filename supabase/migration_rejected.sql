-- ============================================================
-- Migration: store rejected detections (so "what YOLO saw" shows the full original pass)
-- Run this ONCE in the Supabase SQL editor. Safe to re-run.
-- ============================================================

-- Annotation status: 'kept' = survived review (default), 'rejected' = a human threw it out.
-- Rejected rows are stored so the machine's full original pass stays visible,
-- but they are NOT training data.
alter table annotations add column if not exists status text not null default 'kept';
