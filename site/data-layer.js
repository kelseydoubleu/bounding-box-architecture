// data-layer.js
// Real Supabase persistence for Bounding Box Architecture. Matches data-shape-spec.md.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function imgUrl(path) {
  return sb.storage.from('images').getPublicUrl(path).data.publicUrl;
}
function normLabel(s) {
  return (s || '').trim().toLowerCase();
}

// ---- stable anonymous identity (groups one person's work, no login) ----
export function getContributorId() {
  let id = localStorage.getItem('bba_contributor_id');
  if (!id) {
    id = 'anon_' + crypto.randomUUID().slice(0, 8);
    localStorage.setItem('bba_contributor_id', id);
  }
  return id;
}

// ---- classifiers ----
export async function loadClassifiers() {
  const { data, error } = await sb
    .from('classifiers').select('id,name,description').order('created_at');
  if (error) throw error;
  return data;
}

export async function createClassifier(name, { description = null, createdBy = null } = {}) {
  const { data, error } = await sb
    .from('classifiers').insert({ name, description, created_by: createdBy })
    .select().single();
  if (error) throw error;
  return data;
}

// ---- load one classifier's contributions in the site's `items` shape ----
export async function loadClassifierItems(classifierId) {
  const { data: links, error: e1 } = await sb
    .from('classifier_items').select('contribution_id').eq('classifier_id', classifierId);
  if (e1) throw e1;
  const ids = links.map(l => l.contribution_id);
  if (!ids.length) return [];

  // only show active (non-moderated) contributions
  const { data: contribs, error: e2 } = await sb
    .from('contributions').select('*').in('id', ids).eq('status', 'active');
  if (e2) throw e2;

  const { data: anns, error: e3 } = await sb
    .from('annotations').select('*').in('contribution_id', ids);
  if (e3) throw e3;

  const { data: allLinks } = await sb
    .from('classifier_items').select('contribution_id, classifiers(name)').in('contribution_id', ids);
  const savedMap = {};
  (allLinks || []).forEach(l => {
    (savedMap[l.contribution_id] = savedMap[l.contribution_id] || []).push(l.classifiers.name);
  });

  return contribs.map(c => ({
    id: c.id,
    imagePath: c.image_path,
    image: imgUrl(c.image_path),
    thumb: imgUrl('thumbs/' + c.image_path),
    width: c.width,
    height: c.height,
    baseModel: c.base_model,
    lensClassifierId: c.lens_classifier_id,
    lensModelId: c.lens_model_id,
    contributor: c.contributor_name,
    contributorId: c.contributor_id,
    caption: c.caption,
    date: new Date(c.created_at).toLocaleString(),
    lastEditedBy: c.last_edited_by || null,
    lastEditedAt: c.last_edited_at ? new Date(c.last_edited_at).toLocaleString() : null,
    savedTo: savedMap[c.id] || [],
    annotations: anns
      .filter(a => a.contribution_id === c.id)
      .map(a => ({
        label: a.label,
        labelNormalized: a.label_normalized,
        bbox: [a.bx, a.by, a.bw, a.bh],
        source: a.source,
        detector: a.detector,
        modelLabel: a.model_label,
        lensLabel: a.lens_label,
        wasCorrected: a.was_corrected,
        conf: a.conf,
        status: a.status || 'kept'
      }))
  }));
}

// Load the entire archive (all active contributions, regardless of dataset).
export async function loadAllItems() {
  const { data: contribs, error: e2 } = await sb
    .from('contributions').select('*').eq('status', 'active');
  if (e2) throw e2;
  if (!contribs.length) return [];
  const ids = contribs.map(c => c.id);

  const { data: anns, error: e3 } = await sb
    .from('annotations').select('*').in('contribution_id', ids);
  if (e3) throw e3;

  return contribs.map(c => ({
    id: c.id,
    imagePath: c.image_path,
    image: imgUrl(c.image_path),
    thumb: imgUrl('thumbs/' + c.image_path),
    width: c.width,
    height: c.height,
    baseModel: c.base_model,
    lensClassifierId: c.lens_classifier_id,
    lensModelId: c.lens_model_id,
    contributor: c.contributor_name,
    contributorId: c.contributor_id,
    caption: c.caption,
    date: new Date(c.created_at).toLocaleString(),
    createdAt: c.created_at,
    lastEditedBy: c.last_edited_by || null,
    lastEditedAt: c.last_edited_at ? new Date(c.last_edited_at).toLocaleString() : null,
    savedTo: [],
    annotations: anns
      .filter(a => a.contribution_id === c.id)
      .map(a => ({
        label: a.label,
        labelNormalized: a.label_normalized,
        bbox: [a.bx, a.by, a.bw, a.bh],
        source: a.source,
        detector: a.detector,
        modelLabel: a.model_label,
        lensLabel: a.lens_label,
        wasCorrected: a.was_corrected,
        conf: a.conf,
        status: a.status || 'kept'
      }))
  }));
}

// ---- save one image + its confirmed labels to one or more classifiers ----
// Requires consent. annotations: [{ label, bbox, source, detector, modelLabel, lensLabel, conf }]
export async function saveContribution({
  imageDataUrl, thumbDataUrl = null, width, height, baseModel = 'none',
  lensClassifierId = null, lensModelId = null,
  contributorName, contributorId, imageRightsConfirmed,
  caption = null, annotations, classifierIds
}) {
  if (!imageRightsConfirmed) {
    throw new Error('image_rights_confirmed must be true to save (consent required)');
  }

  // 1. upload the image
  const blob = await (await fetch(imageDataUrl)).blob();
  const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const path = `${crypto.randomUUID()}.${ext}`;
  const up = await sb.storage.from('images').upload(path, blob, { contentType: blob.type });
  if (up.error) throw up.error;

  // 1b. small preview for the gallery (best effort; the gallery falls back to the full image)
  if (thumbDataUrl) {
    try {
      const tb = await (await fetch(thumbDataUrl)).blob();
      await sb.storage.from('images').upload('thumbs/' + path, tb, { contentType: tb.type });
    } catch (e) { console.warn('thumbnail upload failed', e); }
  }

  // 2. insert the contribution
  const { data: contrib, error: e1 } = await sb
    .from('contributions')
    .insert({
      image_path: path, width, height, base_model: baseModel,
      lens_classifier_id: lensClassifierId, lens_model_id: lensModelId,
      contributor_name: (contributorName || '').trim() || 'anonymous',
      contributor_id: contributorId || getContributorId(),
      image_rights_confirmed: true, caption, status: 'active'
    })
    .select().single();
  if (e1) throw e1;

  // 3. insert the annotations (with the three-layer label fields)
  const annRows = annotations.map(a => {
    const modelLabel = a.modelLabel ?? null;
    const wasCorrected = (a.wasCorrected != null)
      ? a.wasCorrected
      : (modelLabel != null && normLabel(modelLabel) !== normLabel(a.label));
    return {
      contribution_id: contrib.id,
      bx: a.bbox[0], by: a.bbox[1], bw: a.bbox[2], bh: a.bbox[3],
      source: a.source, detector: a.detector || (a.source === 'human' ? 'human' : baseModel),
      label: a.label, label_normalized: a.labelNormalized || normLabel(a.label),
      model_label: modelLabel, lens_label: a.lensLabel ?? null,
      was_corrected: wasCorrected, conf: a.conf ?? null,
      status: a.status || 'kept'
    };
  });
  const { error: e2 } = await sb.from('annotations').insert(annRows);
  if (e2) throw e2;

  // 4. link the contribution to each chosen classifier
  const linkRows = classifierIds.map(cid => ({ classifier_id: cid, contribution_id: contrib.id }));
  const { error: e3 } = await sb.from('classifier_items').insert(linkRows);
  if (e3) throw e3;

  return contrib.id;
}

// ---- edit an existing contribution: replace its annotations + stamp who/when ----
// Anyone may edit (open collaborative). annotations: same shape as saveContribution's.
export async function updateContribution({ contributionId, annotations, editedBy }) {
  // replace the whole annotation set (full re-edit: relabel, delete, add)
  const { error: e0 } = await sb.from('annotations').delete().eq('contribution_id', contributionId);
  if (e0) throw e0;

  const rows = annotations.map(a => {
    const modelLabel = a.modelLabel ?? null;
    return {
      contribution_id: contributionId,
      bx: a.bbox[0], by: a.bbox[1], bw: a.bbox[2], bh: a.bbox[3],
      source: a.source, detector: a.detector || (a.source === 'human' ? 'human' : 'unknown'),
      label: a.label, label_normalized: a.labelNormalized || normLabel(a.label),
      model_label: modelLabel, lens_label: a.lensLabel ?? null,
      was_corrected: modelLabel != null && normLabel(modelLabel) !== normLabel(a.label),
      conf: a.conf ?? null,
      status: a.status || 'kept'
    };
  });
  if (rows.length) {
    const { error: e1 } = await sb.from('annotations').insert(rows);
    if (e1) throw e1;
  }

  const { error: e2 } = await sb.from('contributions')
    .update({ last_edited_by: (editedBy || '').trim() || 'anonymous', last_edited_at: new Date().toISOString() })
    .eq('id', contributionId);
  if (e2) throw e2;
}

// ---- delete an entire contribution (image + all its labels + classifier links) ----
export async function deleteContribution(contributionId, imagePath) {
  if (imagePath) { try { await sb.storage.from('images').remove([imagePath, 'thumbs/' + imagePath]); } catch (e) {} }
  // annotations + classifier_items cascade via FK on delete
  const { error } = await sb.from('contributions').delete().eq('id', contributionId);
  if (error) throw error;
}

// ---- newest trained model for a classifier, or null ----
export async function getLatestModel(classifierId) {
  const { data, error } = await sb
    .from('models').select('*').eq('classifier_id', classifierId)
    .order('trained_at', { ascending: false }).limit(1);
  if (error) throw error;
  if (!data.length) return null;
  const m = data[0];
  return {
    id: m.id,
    url: sb.storage.from('models').getPublicUrl(m.model_path).data.publicUrl,
    classes: m.classes,
    numExamples: m.num_examples,
    valAccuracy: m.val_accuracy,
    perClassCounts: m.per_class_counts
  };
}
