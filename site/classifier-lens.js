// classifier-lens.js
// Runs a TRAINED classifier over YOLO/COCO-detected regions, entirely in the browser,
// using onnxruntime-web (the same `ort` the site already loads for YOLO).
//
// This is what makes a classifier ACTUALLY AFFECT RESULTS: after the base detector finds
// boxes, you re-read each box through the trained classifier's own vocabulary.

let lensSession = null;
let lensClasses = null;

// Load a trained classifier (call once when the user picks a lens).
//   modelUrl: from getLatestModel(...).url
//   classes:  from getLatestModel(...).classes
export async function loadLens(modelUrl, classes) {
  lensSession = await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] });
  lensClasses = classes;
}

export function lensReady() { return !!lensSession; }
export function unloadLens() { lensSession = null; lensClasses = null; }

// Crop a normalized bbox out of an Image and turn it into a 224x224 ImageNet-normalized tensor.
// (Must match the preprocessing in train_classifier.py exactly.)
function preprocessCrop(img, bbox) {
  const [nx, ny, nw, nh] = bbox;
  const W = img.naturalWidth, H = img.naturalHeight;
  const sx = Math.max(0, nx * W), sy = Math.max(0, ny * H);
  const sw = Math.max(1, nw * W), sh = Math.max(1, nh * H);

  const c = document.createElement('canvas');
  c.width = 224; c.height = 224;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 224, 224);

  const { data } = ctx.getImageData(0, 0, 224, 224);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const plane = 224 * 224, arr = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    arr[i]             = (data[i * 4]     / 255 - mean[0]) / std[0];
    arr[plane + i]     = (data[i * 4 + 1] / 255 - mean[1]) / std[1];
    arr[2 * plane + i] = (data[i * 4 + 2] / 255 - mean[2]) / std[2];
  }
  return new ort.Tensor('float32', arr, [1, 3, 224, 224]);
}

// Classify one region. Returns the winning label, its confidence, and the FULL distribution
// (the full distribution is the "under the hood" view — what else it almost said).
export async function classifyRegion(img, bbox) {
  if (!lensSession) throw new Error('lens not loaded — call loadLens() first');
  const input = preprocessCrop(img, bbox);
  const feeds = {}; feeds[lensSession.inputNames[0]] = input;
  const out = await lensSession.run(feeds);
  const logits = out[lensSession.outputNames[0]].data;

  let mx = -Infinity;
  for (const v of logits) if (v > mx) mx = v;
  let sum = 0;
  const exps = Array.from(logits, v => { const e = Math.exp(v - mx); sum += e; return e; });
  const probs = exps.map(e => e / sum);

  const dist = lensClasses
    .map((label, i) => ({ label, p: probs[i] }))
    .sort((a, b) => b.p - a.p);

  return { label: dist[0].label, conf: dist[0].p, dist };
}

// Convenience: relabel an array of detections in place through the lens.
//   img: the HTMLImageElement; detections: [{bbox:[x,y,w,h], ...}]
export async function applyLens(img, detections) {
  const out = [];
  for (const d of detections) {
    const r = await classifyRegion(img, d.bbox);
    out.push({ ...d, label: r.label, conf: r.conf, dist: r.dist });
  }
  return out;
}
