"""
train_classifier.py
--------------------
Train a classifier on the crops collected in Supabase, export it to ONNX, and upload
it back so the website can run it as a lens. Run this whenever enough new data has
accumulated (weekly, before a check-in, etc).

Best run in Google Colab (free GPU) or locally with Python 3.10+.

INSTALL:
    pip install supabase torch torchvision pillow onnx

SET (environment variables, or edit the constants below):
    SUPABASE_URL            your project url
    SUPABASE_SERVICE_KEY    the *service_role* key (Settings -> API). This key bypasses
                            RLS so it can read everything and upload the model. KEEP IT
                            PRIVATE -- never put it in the website.
    CLASSIFIER_NAME         which classifier to train (default: "our custom classifier")

RUN:
    python train_classifier.py
"""

import os, io, tempfile, shutil, collections
from supabase import create_client
from PIL import Image
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split
from torchvision import datasets, transforms, models

SUPABASE_URL    = os.environ.get("SUPABASE_URL", "PASTE_YOUR_URL")
SERVICE_KEY     = os.environ.get("SUPABASE_SERVICE_KEY", "PASTE_YOUR_SERVICE_ROLE_KEY")
CLASSIFIER_NAME = os.environ.get("CLASSIFIER_NAME", "our custom classifier")

MIN_PER_CLASS = 15     # labels with fewer crops than this are skipped (too few to learn)
EPOCHS        = 12
DEVICE        = "cuda" if torch.cuda.is_available() else "cpu"

sb = create_client(SUPABASE_URL, SERVICE_KEY)

# ---------------------------------------------------------------------------
# 1. Find the classifier
# ---------------------------------------------------------------------------
cls = sb.table("classifiers").select("*").eq("name", CLASSIFIER_NAME).single().execute().data
cid = cls["id"]
print(f"classifier: {CLASSIFIER_NAME}  ({cid})")

# ---------------------------------------------------------------------------
# 2. Which contributions belong to it
# ---------------------------------------------------------------------------
links = sb.table("classifier_items").select("contribution_id").eq("classifier_id", cid).execute().data
contrib_ids = [l["contribution_id"] for l in links]
print(f"contributions: {len(contrib_ids)}")
if not contrib_ids:
    raise SystemExit("No data in this classifier yet -- go label some images first.")

# ---------------------------------------------------------------------------
# 3. Pull contributions + annotations (chunked to stay under query limits)
# ---------------------------------------------------------------------------
contribs = {}
anns = []
for i in range(0, len(contrib_ids), 100):
    chunk = contrib_ids[i:i + 100]
    for r in sb.table("contributions").select("*").in_("id", chunk).execute().data:
        contribs[r["id"]] = r
    anns += sb.table("annotations").select("*").in_("contribution_id", chunk).eq("status", "kept").execute().data
print(f"annotations: {len(anns)}")

# ---------------------------------------------------------------------------
# 4. Download each image (cached) and crop every annotation into class folders.
#    The folder name == the label == the model's vocabulary. (This is the thesis:
#    the dataset you authored becomes the model's entire worldview.)
# ---------------------------------------------------------------------------
workdir = tempfile.mkdtemp()
dataset_dir = os.path.join(workdir, "dataset")
img_cache = {}

def get_image(path):
    if path not in img_cache:
        raw = sb.storage.from_("images").download(path)
        img_cache[path] = Image.open(io.BytesIO(raw)).convert("RGB")
    return img_cache[path]

counts = collections.Counter()
for a in anns:
    c = contribs.get(a["contribution_id"])
    if not c:
        continue
    img = get_image(c["image_path"])
    W, H = img.size
    left, top = a["bx"] * W, a["by"] * H
    right, bottom = (a["bx"] + a["bw"]) * W, (a["by"] + a["bh"]) * H
    if right - left < 4 or bottom - top < 4:
        continue
    label = a["label"].strip().lower()
    d = os.path.join(dataset_dir, label)
    os.makedirs(d, exist_ok=True)
    img.crop((left, top, right, bottom)).save(os.path.join(d, f"{counts[label]}.jpg"))
    counts[label] += 1

# Drop labels with too few examples to learn anything
for label, n in list(counts.items()):
    if n < MIN_PER_CLASS:
        print(f"  skipping '{label}' ({n} < {MIN_PER_CLASS} crops)")
        shutil.rmtree(os.path.join(dataset_dir, label))
        del counts[label]

if len(counts) < 2:
    raise SystemExit(
        f"Need at least 2 labels with >= {MIN_PER_CLASS} crops to train. "
        f"Currently have: {dict(counts)}. Collect more, then re-run."
    )
print("training on:", dict(counts))

# ---------------------------------------------------------------------------
# 5. Train ResNet18 with transfer learning (frozen backbone, new final layer)
# ---------------------------------------------------------------------------
tf = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])
full = datasets.ImageFolder(dataset_dir, transform=tf)
class_names = full.classes
n_val = max(1, int(0.2 * len(full)))
tr, val = random_split(full, [len(full) - n_val, n_val])
tl = DataLoader(tr, batch_size=16, shuffle=True)
vl = DataLoader(val, batch_size=16)

model = models.resnet18(weights=models.ResNet18_Weights.DEFAULT)
for p in model.parameters():
    p.requires_grad = False
model.fc = nn.Linear(model.fc.in_features, len(class_names))
model = model.to(DEVICE)
opt = torch.optim.Adam(model.fc.parameters(), lr=1e-3)
lossf = nn.CrossEntropyLoss()

val_acc = 0.0
for ep in range(EPOCHS):
    model.train()
    for x, y in tl:
        x, y = x.to(DEVICE), y.to(DEVICE)
        opt.zero_grad()
        lossf(model(x), y).backward()
        opt.step()
    model.eval()
    correct = total = 0
    with torch.no_grad():
        for x, y in vl:
            x, y = x.to(DEVICE), y.to(DEVICE)
            correct += (model(x).argmax(1) == y).sum().item()
            total += y.size(0)
    val_acc = correct / max(1, total)
    print(f"epoch {ep + 1:2d}/{EPOCHS}  val_acc {100 * val_acc:.1f}%")

# ---------------------------------------------------------------------------
# 6. Export to ONNX (so the browser can run it)
# ---------------------------------------------------------------------------
model.eval()
onnx_path = os.path.join(workdir, "classifier.onnx")
dummy = torch.randn(1, 3, 224, 224, device=DEVICE)
torch.onnx.export(
    model, dummy, onnx_path,
    input_names=["input"], output_names=["logits"],
    dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
    opset_version=12,
)
print("exported classifier.onnx")

# ---------------------------------------------------------------------------
# 7. Upload the model and register it (the website reads the newest row)
# ---------------------------------------------------------------------------
model_path = f"{cid}/classifier.onnx"
with open(onnx_path, "rb") as f:
    sb.storage.from_("models").upload(
        model_path, f.read(),
        {"content-type": "application/octet-stream", "upsert": "true"},
    )
sb.table("models").insert({
    "classifier_id": cid,
    "model_path": model_path,
    "classes": class_names,
    "num_examples": sum(counts.values()),
    "val_accuracy": round(val_acc, 4),
    "per_class_counts": {k: counts[k] for k in class_names},
}).execute()

print(f"\ndone -- uploaded {model_path}")
print(f"vocabulary the model can now output: {class_names}")
print("the website will pick this up automatically as a lens for this classifier.")
