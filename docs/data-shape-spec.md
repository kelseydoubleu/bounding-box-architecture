# Bounding Box Architecture — data shape specification

The definitive structure of the dataset. Lock this once; the visual design can change
forever after without touching it. The only expensive thing to change later is the *fields*
below — so this is the thing to get right before building the backend.

Database-agnostic: maps cleanly onto Supabase (Postgres tables) or Firebase (Firestore
collections). Field names use `snake_case`; adjust casing to taste but keep the shape.

---

## Design principles

1. **Preserve the machine-vs-human gap.** When a person corrects a label, keep what the
   model originally said. That gap is the project's core evidence, not a detail to discard.
2. **Store provenance.** Every box knows which detector (or human) produced it.
3. **Separate display from training.** Keep the human's exact phrasing *and* a normalized
   form for clustering and training folders.
4. **Be honest by default.** Trained models store their own accuracy and counts so the UI
   can show them rather than imply more than it knows.
5. **Consent and identity are first-class**, because this is a public dataset of images that
   may contain real people — the exact dynamic the project examines.

---

## Entities

### `contribution` — one uploaded image

| field | type | required | why |
|-------|------|----------|-----|
| `id` | uuid / string | yes | primary key |
| `image_path` | string | yes | path in storage bucket (not the raw base64) |
| `width` | int | yes | source pixel width — needed to crop boxes without distortion |
| `height` | int | yes | source pixel height — same |
| `base_model` | string | yes | which detector was run: `yolo11`, `coco-ssd`, or `none` (hand-labeled) |
| `lens_classifier_id` | uuid / string | no | which classifier was applied as a lens at detection time; `null` if raw base-model/human labeling. records that this contribution was seen *through* a trained worldview |
| `lens_model_id` | uuid / string | no | the *specific trained model version* used as the lens (classifiers retrain over time; v1 reads differently than v5). lets you reconstruct exactly which trained state shaped this contribution |
| `contributor_name` | string | yes | the name the person typed (display). defaults to `"anonymous"` if blank |
| `contributor_id` | string | yes | random per-person id (e.g. stored in their browser) so one person's contributions can be grouped without logins |
| `image_rights_confirmed` | bool | yes | the consent checkbox — must be `true` to save. records that the contributor affirmed they have the right to share this image |
| `caption` | string | no | optional narrative line (your "detected: a game of tag") |
| `status` | string | yes | `active` / `hidden` / `flagged` — moderation without hard-deleting |
| `last_edited_by` | string | no | name of whoever last edited this entry; `null` if never edited |
| `last_edited_at` | timestamp | no | when it was last edited; `null` if never edited |
| `created_at` | timestamp | yes | when it was added |

### `annotation` — one labeled box on a contribution

| field | type | required | why |
|-------|------|----------|-----|
| `id` | uuid / string | yes | primary key |
| `contribution_id` | uuid / string | yes | which image it belongs to |
| `bbox` | `[x, y, w, h]` floats 0–1 | yes | normalized box, resolution-independent |
| `source` | string | yes | `model` or `human` (who drew the box) |
| `detector` | string | yes | `yolo11`, `coco-ssd`, or `human` (who proposed it) |
| `label` | string | yes | final label, **exactly as displayed** (preserves the person's phrasing) |
| `label_normalized` | string | yes | lowercased + trimmed — used for clustering and as the training folder name |
| `model_label` | string | no | what the base detector originally proposed; `null` if the box was hand-drawn |
| `lens_label` | string | no | what the trained lens classifier called this region; `null` if no lens was used. distinct from `model_label` (base detector) and `label` (human's final word) |
| `was_corrected` | bool | yes | did the human change the label away from `model_label` |
| `status` | string | yes | `kept` (survived review) or `rejected` (a human threw it out — stored so the machine's full original pass stays visible, but excluded from training) |
| `conf` | float | no | model confidence (0–1); `null` for human-drawn boxes |
| `created_at` | timestamp | yes | when it was added |

> The pairing of `model_label` + `label` + `was_corrected` is the dataset's most valuable
> output: it records every place a human overruled the machine's vision. With `lens_label`
> added, a single box can carry **three layers of vision** — base detector (`model_label`),
> trained classifier (`lens_label`), and human (`label`) — so you can trace exactly how each
> reading diverged.

> **The feedback loop.** `lens_classifier_id` / `lens_model_id` (on the contribution) and
> `lens_label` (on the annotation) exist to make the system's self-reinforcement *visible*.
> Once a classifier is trained and used as a lens, it shapes how new images get labeled, and
> those labels feed back into training its next version. Recording which lens (and which exact
> model version) was active lets you tell "fresh human reading" apart from "the model seeing
> through its own trained worldview" — the self-referential dynamic at the heart of the project.
> These fields stay `null` at page zero and through first data collection; they only start
> recording once a lens is live, so add them now but don't let them complicate the early build.

### `classifier` — a named vocabulary / dataset

| field | type | required | why |
|-------|------|----------|-----|
| `id` | uuid / string | yes | primary key |
| `name` | string | yes | unique display name (e.g. "our custom classifier") |
| `description` | string | no | what this vocabulary is for |
| `created_by` | string | no | contributor_name of the creator |
| `created_at` | timestamp | yes | when it was made |

### `classifier_item` — which classifiers a contribution was saved to (many-to-many)

| field | type | required | why |
|-------|------|----------|-----|
| `classifier_id` | uuid / string | yes | the classifier |
| `contribution_id` | uuid / string | yes | the image |
| `created_at` | timestamp | yes | when it was linked |

> "Upload to all" = one contribution linked to several classifiers. The detail view's
> "saved to" list is built from these links.

### `model` — one trained classifier artifact

| field | type | required | why |
|-------|------|----------|-----|
| `id` | uuid / string | yes | primary key |
| `classifier_id` | uuid / string | yes | which vocabulary it was trained on |
| `model_path` | string | yes | path to the `.onnx` file in storage |
| `classes` | string[] | yes | label order = model output order (index → class name) |
| `num_examples` | int | yes | total crops trained on |
| `val_accuracy` | float | no | validation accuracy — show it, don't imply more |
| `per_class_counts` | json | no | `{ "figure": 142, "ground": 98 }` — honest per-label coverage |
| `trained_at` | timestamp | yes | when it was trained (site loads the newest) |

---

## Relationships

```
classifier  1───∞  classifier_item  ∞───1  contribution  1───∞  annotation
classifier  1───∞  model
contribution  ∞───1  classifier   (lens_classifier_id — which lens was active at detection)
contribution  ∞───1  model        (lens_model_id — the exact trained version used)
```

The `classifier_item` link is "saved to" (became training data). The `lens_*` links are
"seen through" (a trained classifier shaped the labels). Two different relationships — keep
both: one feeds the model, the other records the model feeding back.

A contribution has many annotations and can belong to many classifiers. A classifier has
many contributions (via links) and many trained models over time (newest wins).

---

## Identity & consent (the two decisions, made)

- **Identity:** contributors type a name (free text). It's stored as `contributor_name` for
  display and defaults to `"anonymous"` if left blank. A random `contributor_id` is generated
  per browser so one person's contributions can be grouped — no logins, no friction.
- **Consent:** a required checkbox — *"I have the right to share this image"* — recorded as
  `image_rights_confirmed`. The save action is blocked unless it's `true`. This is both an
  ethical baseline for a public image dataset and an on-theme acknowledgment that the project
  is itself collecting and labeling images of people.

**UI implication for the save step (step 3 of the detect flow):** before "save labels," show
a name field and the consent checkbox. Disable saving until consent is checked. (Name optional;
consent required.)

---

## Deliberately out of scope (for now)

- **Full confidence distribution per box** (the "what else it almost said" list) — lovely for
  the under-the-hood view, but heavy to store on every annotation. Add later if needed; the
  trained lens already returns it live at inference time.
- **Label edit history / versioning** — `model_label` + `label` + `was_corrected` captures the
  one correction that matters; full version history is overkill.
- **Real authentication** — name + anon id is enough until there's a reason for accounts.

---

## Example record (one image, two boxes)

```json
{
  "contribution": {
    "id": "c_8f3a",
    "image_path": "8f3a....jpg",
    "width": 1620, "height": 1080,
    "base_model": "yolo11",
    "lens_classifier_id": "cls_ours",
    "lens_model_id": "model_v3",
    "contributor_name": "kel",
    "contributor_id": "anon_4b7c",
    "image_rights_confirmed": true,
    "caption": "a game of tag",
    "status": "active",
    "created_at": "2026-06-30T04:12:00Z"
  },
  "annotations": [
    {
      "id": "a_01", "contribution_id": "c_8f3a",
      "bbox": [0.29, 0.34, 0.18, 0.52],
      "source": "model", "detector": "yolo11",
      "label": "person running, stressed", "label_normalized": "person running, stressed",
      "model_label": "person", "lens_label": "figure", "was_corrected": true,
      "conf": 0.91, "created_at": "2026-06-30T04:12:05Z"
    },
    {
      "id": "a_02", "contribution_id": "c_8f3a",
      "bbox": [0.62, 0.40, 0.16, 0.48],
      "source": "human", "detector": "human",
      "label": "martini glass", "label_normalized": "martini glass",
      "model_label": null, "lens_label": null, "was_corrected": false,
      "conf": null, "created_at": "2026-06-30T04:12:40Z"
    }
  ]
}
```

The first box is the whole argument in one record, now across three layers: YOLO (`model_label`)
said `person`, the trained lens (`lens_label`) re-read it as `figure`, and the human (`label`)
overruled both with `person running, stressed` (`was_corrected: true`). The contribution itself
records that lens v3 of "our custom classifier" was active. The second box is a thing every layer
of the machine had no word for at all — drawn and named by a human, with both model fields `null`.
