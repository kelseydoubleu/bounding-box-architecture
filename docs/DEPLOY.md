# Bounding Box Architecture — backend deploy guide

This turns the prototype from "resets on reload" into a real system: contributions
**persist** in a database, you can **train** a classifier on them, and the trained model
runs back in the browser so the classifier **actually affects results**.

Three moving parts, all free-tier:

- **Supabase** — stores images + labels + which-classifier metadata, and holds trained models.
- **Your frontend** — the app you already have, hosted statically, embedded into Cargo via an iframe.
- **The training script** — run occasionally in Google Colab to produce a trained model.

Nothing needs an always-on server. Inference happens in the browser (same as YOLO already does).

---

## Files in this package

| File | What it is | Goes where |
|------|------------|------------|
| `supabase_schema.sql` | Database tables + storage buckets + access rules | Run once in Supabase |
| `config.example.js` | Template for your Supabase keys | Rename to `config.js`, fill in, ship with the site |
| `data-layer.js` | Swaps in-memory state for real save/load | Imported by the site |
| `classifier-lens.js` | Runs the trained model in the browser | Imported by the site |
| `train_classifier.py` | Pulls crops, trains, exports ONNX, uploads | Run in Colab / locally |
| `requirements.txt` | Python deps for training | Used by the training step |

---

## Suggested order for the day (~half a day, most of it not coding)

1. Set up Supabase (~30 min) — steps 1–2 below.
2. Host the frontend + wire in the data layer (~1–2 hrs) — steps 3–4.
3. **Collect data** (~2–3 hrs, the real work) — step 5. Label enough images that training has something to chew on.
4. Train + load the lens (~30–60 min) — steps 6–7.

If the day runs short, stop after step 5: "persistence works and the dataset is accumulating, training script is ready" is already a strong check-in. Training (steps 6–7) is the bonus.

---

## 1. Create the Supabase project

1. Go to supabase.com → sign in → **New project**. Pick a name, a strong DB password, a region near you. Free tier is fine.
2. Wait ~2 min for it to provision.

## 2. Run the schema

1. In the project: **SQL Editor → New query**.
2. Paste the entire contents of `supabase_schema.sql` → **Run**.
3. This creates the tables, two storage buckets (`images`, `models`), the access rules, and seeds one classifier named `our custom classifier`.
4. Sanity check: **Table Editor** should now list `classifiers`, `contributions`, `annotations`, `classifier_items`, `models`. **Storage** should list the `images` and `models` buckets.

> Security note: the schema allows anyone to read and to insert (so the public can contribute with no login). That's correct for a class prototype. Before any real public launch, tighten the insert policies to require auth.

## 3. Get your keys and make config.js

1. **Project Settings → API.**
2. Copy **Project URL** and the **anon public** key.
3. Rename `config.example.js` → `config.js` and paste them in.
4. Do **not** copy the `service_role` key into the site — that one is only for the training script.

## 4. Host the frontend and wire in the data layer

**Host it.** The app is static (HTML + JS), so any static host works:
- Easiest: drag the folder into **Netlify** (netlify.com/drop) or deploy with **Vercel**. You get a URL like `https://your-app.vercel.app`.
- Then in Cargo: add an **HTML / embed block** to a page and drop in:
  `<iframe src="https://your-app.vercel.app" style="width:100%;height:90vh;border:0"></iframe>`
  Cargo shows it in your portfolio; the app actually runs on the host. (Confirm your Cargo plan allows embed/HTML blocks — most do.)

**Wire the data layer.** In the site's `<script>`, import the helpers and replace four things:

```js
import { loadClassifiers, createClassifier, loadClassifierItems,
         saveContribution, getLatestModel } from './data-layer.js';
```

- **On load** → replace the hardcoded `classifiers` array. Call `loadClassifiers()` and use the returned `[{id,name}]`. When the data page opens a classifier, call `loadClassifierItems(id)` and put the result into that classifier's `items` before rendering.
- **`saveAll()`** → instead of pushing to the in-memory array, call:
  ```js
  await saveContribution({
    imageDataUrl: imgURL, width: img.naturalWidth, height: img.naturalHeight,
    baseModel: model,                      // 'yolo11' | 'coco-ssd' | 'none'
    lensClassifierId: activeLensClassifierId || null,   // null until a lens is used
    lensModelId: activeLensModelId || null,
    contributorName: nameInput.value,      // the name field (step 3)
    contributorId: getContributorId(),     // from data-layer.js (anon, per-browser)
    imageRightsConfirmed: consentCheckbox.checked,      // REQUIRED true
    annotations: anns.filter(a => a.status === 'confirmed').map(a => ({
      label: a.label, bbox: a.bbox, source: a.source,
      detector: a.source === 'human' ? 'human' : model,
      modelLabel: a.modelLabel ?? null,    // base detector's original guess
      lensLabel: a.lensLabel ?? null,      // trained lens reading, if a lens was applied
      conf: a.conf
    })),
    classifierIds: classifiers.filter(c => c.selected).map(c => c.id)
  });
  ```
  Import `getContributorId` alongside the others from `./data-layer.js`.

  > **Step-3 UI (required by the spec):** add a **name field** and a **consent checkbox**
  > (*"I have the right to share this image"*) to the save step. Disable the save button until
  > the checkbox is ticked — `saveContribution` throws if `imageRightsConfirmed` isn't true.
  > Also: when you relabel a model box, stash the detector's original word as `a.modelLabel`
  > before overwriting `a.label`, so the machine-vs-human gap is preserved.
- **`createCls()`** → call `await createClassifier(name)` and use the returned `{id,name}`.
- **Data page render** → before drawing the constellation/gallery, `await loadClassifierItems(dataCls)` so it shows live data.

(The shapes returned by `data-layer.js` already match the site's `items` / `annotations` structure, so the rendering code doesn't change.)

That alone gives you real persistence: contributions survive reloads and are shared across everyone who opens the page.

## 5. Collect the data (the part only you can do)

Open the live site and label images until each label you care about has **at least ~30–50 examples** (15 is the bare floor the trainer accepts; 50+ is where it gets usable, 100+ is solid). Pick 3–5 labels that make an argument — e.g. `figure` / `ground`, or your architectural vocabulary. This curation *is* the thesis work, not setup overhead.

## 6. Train

In Google Colab (free GPU) or locally:

```bash
pip install -r requirements.txt
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_KEY="your-service-role-key"   # Settings → API → service_role. keep private.
export CLASSIFIER_NAME="our custom classifier"
python train_classifier.py
```

It pulls every crop for that classifier, trains a ResNet18 transfer model, prints validation accuracy per epoch, exports `classifier.onnx`, uploads it, and registers it in the `models` table. Labels with too few crops are skipped with a message.

## 7. Turn on the lens in the browser

In the site, import the lens helpers:

```js
import { loadLens, applyLens, lensReady } from './classifier-lens.js';
import { getLatestModel } from './data-layer.js';
```

When the user picks a classifier as a lens (the "apply a lens" row on the detect page):

```js
const m = await getLatestModel(classifierId);
if (m) {
  await loadLens(m.url, m.classes);   // downloads the ONNX once
}
```

Then, after the base detector returns boxes, re-label them through the lens:

```js
if (lensReady()) {
  anns = await applyLens(img, anns);  // each box now carries a label from the classifier's vocabulary
  draw(); renderDets();
}
```

That's the payoff moment: the boxes are now labeled in the vocabulary **you** trained — show it a chair when the classifier only knows `figure`/`ground` and it must commit to one. `applyLens` also returns the full distribution per box (`.dist`), which is your "under the hood" confidence view.

---

## How retraining works long-term

Training is batch, not live. As more labels come in, re-run `train_classifier.py` — it always reads the current data and uploads a fresh model; the site automatically loads the newest. So the model updates in deliberate steps ("retrained on the accumulated dataset"), which is a cleaner research story than continuous learning anyway.

## What to say at the check-in

- Persistence is real: the dataset lives in Supabase and accumulates across everyone.
- Detection runs locally in the browser; images are only stored when someone saves to a classifier.
- You trained a first classifier on the collected crops and it runs back in the browser as a lens.
- Next: more data per label for accuracy; embeddings to place any label by meaning; possibly fine-tuning a detector for architectural elements COCO can't see.
