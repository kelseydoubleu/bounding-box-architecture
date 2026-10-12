-- ============================================================
-- Bounding Box Architecture - Supabase schema (matches data-shape-spec.md)
-- Run this ONCE in the Supabase SQL editor (Dashboard -> SQL -> New query -> paste -> Run).
-- ============================================================

-- Each classifier is a named vocabulary / dataset
create table if not exists classifiers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_by text,
  created_at timestamptz default now()
);

-- One trained classifier artifact (defined before contributions so lens_model_id can reference it)
create table if not exists models (
  id uuid primary key default gen_random_uuid(),
  classifier_id uuid not null references classifiers(id) on delete cascade,
  model_path text not null,             -- path in the 'models' storage bucket (.onnx)
  classes jsonb not null,               -- ["figure","ground",...] index order = model output order
  num_examples int,
  val_accuracy real,                    -- validation accuracy; show it, don't imply more
  per_class_counts jsonb,               -- {"figure":142,"ground":98} honest per-label coverage
  trained_at timestamptz default now()
);

-- One uploaded image
create table if not exists contributions (
  id uuid primary key default gen_random_uuid(),
  image_path text not null,             -- path in the 'images' storage bucket
  width int not null,
  height int not null,
  base_model text not null default 'none',          -- 'yolo11' | 'coco-ssd' | 'none'
  lens_classifier_id uuid references classifiers(id) on delete set null,  -- lens active at detection (nullable)
  lens_model_id uuid references models(id) on delete set null,            -- exact trained version used (nullable)
  contributor_name text not null default 'anonymous',
  contributor_id text not null,         -- random per-browser id, groups one person's work
  image_rights_confirmed boolean not null default false,                 -- consent checkbox; must be true to save
  caption text,                         -- optional narrative line
  status text not null default 'active',-- 'active' | 'hidden' | 'flagged' (moderation, no hard delete)
  last_edited_by text,                  -- name of whoever last edited this entry (collaborative editing)
  last_edited_at timestamptz,           -- when it was last edited
  created_at timestamptz default now()
);

-- One labeled box on a contribution (bbox normalized 0..1)
create table if not exists annotations (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references contributions(id) on delete cascade,
  bx real not null,
  by real not null,
  bw real not null,
  bh real not null,
  source text not null default 'model', -- 'model' | 'human' (who drew the box)
  detector text not null default 'human', -- 'yolo11' | 'coco-ssd' | 'human' (who proposed it)
  label text not null,                  -- final label, exactly as displayed
  label_normalized text not null,       -- lowercased + trimmed; clustering + training folder name
  model_label text,                     -- base detector's original guess; null if hand-drawn
  lens_label text,                      -- trained lens classifier's reading; null if no lens used
  was_corrected boolean not null default false, -- did the human change the label away from model_label
  conf real,                            -- model confidence 0..1; null for human-drawn
  status text not null default 'kept',  -- 'kept' = survived review; 'rejected' = a human threw it out (kept for the record, not training data)
  created_at timestamptz default now()
);

-- Which classifiers a contribution was SAVED TO (many-to-many = "upload to all")
create table if not exists classifier_items (
  classifier_id uuid not null references classifiers(id) on delete cascade,
  contribution_id uuid not null references contributions(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (classifier_id, contribution_id)
);

-- Seed the default classifier so the site has one on day zero
insert into classifiers (name) values ('our custom classifier')
on conflict (name) do nothing;

-- ============================================================
-- Storage buckets (public read)
-- ============================================================
insert into storage.buckets (id, name, public) values ('images', 'images', true) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('models', 'models', true) on conflict do nothing;

-- ============================================================
-- Row Level Security
-- Research-prototype settings: anyone may READ, and anyone (anon key) may INSERT
-- contributions/annotations/links/classifiers. Models are written only by the training
-- script (service_role key, which bypasses RLS). Moderation (status) is done by you via the
-- dashboard. LOCK THIS DOWN (require auth for inserts) before any real public launch.
-- ============================================================
alter table classifiers      enable row level security;
alter table contributions    enable row level security;
alter table annotations      enable row level security;
alter table classifier_items enable row level security;
alter table models           enable row level security;

create policy "read classifiers"      on classifiers      for select using (true);
create policy "read contributions"    on contributions    for select using (true);
create policy "read annotations"      on annotations      for select using (true);
create policy "read classifier_items" on classifier_items for select using (true);
create policy "read models"           on models           for select using (true);

create policy "insert classifiers"      on classifiers      for insert with check (true);
create policy "insert contributions"    on contributions    for insert with check (true);
create policy "insert annotations"      on annotations      for insert with check (true);
create policy "insert classifier_items" on classifier_items for insert with check (true);

-- Open collaborative editing: anyone may update/delete (prototype; tighten before public launch)
create policy "update contributions" on contributions for update using (true) with check (true);
create policy "delete contributions" on contributions for delete using (true);
create policy "update annotations" on annotations for update using (true) with check (true);
create policy "delete annotations" on annotations for delete using (true);
create policy "delete classifier_items" on classifier_items for delete using (true);

-- Storage object policies: anon can upload images, read both buckets, delete images
create policy "upload images" on storage.objects
  for insert with check (bucket_id = 'images');
create policy "read media" on storage.objects
  for select using (bucket_id in ('images', 'models'));
create policy "delete images" on storage.objects
  for delete using (bucket_id = 'images');
