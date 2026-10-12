# Bounding Box Architecture

A machine-vision probe for architectural representation. You upload an image, run it through object-detection models, and see what they recognize and — more to the point — what they can't. Whatever the machine has no word for dissolves into noise. People contribute labels to a shared archive, and eventually there's enough data to fine-tune a model that sees what the base models miss.

**Live:** boundingboxarch.netlify.app (also embedded in the Cargo portfolio site)

_Last updated: July 13, 2026_

---

## What it does

Upload an image → pick a detector → it boxes what it can name → a pixelation reveal shows what it can't → you walk through each box (keep / relabel / reject) and draw anything it missed → save to a shared archive.

Every saved image has a toggle between "what the model saw" (pixelated, with the machine's labels) and "what we see" (the final human labels). That contrast is the whole thesis: a model can only see what its training data named, and architecture is full of things COCO never named.

## What's built

- **Six detectors:** five YOLO variants (11n/s/m, 12n/s) plus COCO-SSD, with a confidence slider. All trained on COCO's 80 everyday classes — none of them knows what a building is.
- **The detect → review → save flow,** including the breathing pixelation reveal and the zoom-walk review.
- **The archive:** gallery, grouped-by-label, and constellation views, with full edit/delete. Everything shows as one combined archive.

## How it's put together

It's a single-page app — four files: `index.html` (the whole UI and logic), `data-layer.js` (talks to the database), `classifier-lens.js` (runs a custom model in the browser once one is trained), and `config.js` (the database keys). Everything runs in the browser, which is why it embeds cleanly in Cargo as an iframe — there's no server to keep running. Models load in-browser (YOLO via ONNX Runtime, COCO-SSD via TensorFlow.js), and images only get uploaded when you hit save.

## Where it lives

- **Site:** Netlify → boundingboxarch.netlify.app, embedded in Cargo.
- **Backend:** Supabase — the database, the image storage, and all the student data.
- **Model files:** served from a third-party GitHub repo (nomi30701). It works, but it's someone else's repo — if they delete it, detection breaks. Worth self-hosting our own copy before the workshop.
- Currently everything is on Supabase's **free tier**, which is the thing to sort out below.

---

## Storage — the thing to handle before the workshop

_Verified against Supabase's pricing, July 2026._

The free tier gives us about **1 GB of image storage** (one source says 500 MB — worth confirming), and projects **auto-pause after a week of no activity.** That's a problem for a workshop: 100 students × 5 images is ~500 images, and at 1–3 MB each (more for phone photos) that's 0.5–1.5 GB — right at or over the limit. And if the site sits quiet between class and the follow-up week, it could pause and go offline.

**What to do:**

1. **Compress images on upload** — regardless of anything else. Shrinking each image to ~1200px / a few hundred KB takes 500 images from ~1 GB down to ~150 MB, and it fixes the slow loading too. This is a code change on our end, no cost.
2. **Turn on Supabase Pro for the workshop month** (~$25) — 8 GB storage, no auto-pause, plenty of headroom. Downgrade after.
3. Ideally both: compress to stay small, Pro to remove the pause risk.

**Recommendation:** do the compression regardless, and run Pro for the one workshop month (~$25), then downgrade.

---

## Handing this off

The goal is that Amelyn (and students after her) can run and change this without me. That means three things need to happen, roughly in order of how easily the project dies without them:

**1. Put the code on GitHub.** Right now the only copy that deploys lives in a folder on my laptop, pushed to Netlify by hand. That's the biggest fragility — one lost folder and no one can change a line. A GitHub repo fixes it: it becomes the single source of truth, anyone we authorize can get it, and it's also the license-compliance step (YOLO is AGPL, so the code should be public anyway). **Amelyn will need a GitHub account** so the repo can be transferred to or shared with her. The repo should hold the four app files, the backend SQL + training script, both markdown docs, a README, and an AGPL license file.

**2. Transfer the accounts.** This is the part that's easy to forget and the part that actually decides whether the project survives. It currently runs on services under my personal accounts:
- **Supabase** holds all the data and carries the storage cost. This can't stay on my account after a full handoff — Amelyn needs to own it or have a clear plan for it. *This is the most important handoff decision.*
- **Netlify** is where the site deploys. Same deal — if it's my account and I'm gone, no one can redeploy.
- **The model files** live in a stranger's GitHub repo. Before handing off, we should self-host our own copy so detection can't break out from under whoever inherits this.

**3. Write down the operational knowledge.** How to redeploy, how to train the classifier in Colab, the workshop plan — the stuff currently in my head or in our chat. Some is already in these docs; the rest should go in the README so nobody has to reverse-engineer it.

**Short version:** the demo already survives on its own. GitHub makes the code survivable. Transferring Supabase + Netlify (and self-hosting the models) makes the *whole thing* survivable. That last part is the real handoff — most projects skip it and quietly die when a password or a bill goes unpaid.

---

## Other open items (not urgent)

- Speed: cache models, lazy-load gallery images (compression helps most of this).
- Backend tidy: re-tag old entries so everything sits under one dataset (cosmetic — the view already combines them).
- Move the confidence slider to after detection.
- Gallery back to vertical scroll.
- Make the "draw box" button clearer in the editor.
- Constellation: click a node to open its image.
- Before it's fully public: repo public under AGPL-3.0, tighten the open edit/delete permissions.
