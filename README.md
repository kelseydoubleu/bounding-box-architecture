# bounding box architecture

A machine vision probe for architectural images. Upload an image, run it through object detection models, and see what they recognize and what they can't. Everything the model has no word for dissolves into noise. People label what it missed, and those labels build a shared archive.

Live: https://boundingboxarch.netlify.app

A research project with Amelyn Ng, Columbia GSAPP.

## What's here

```
site/        the website (this is what Netlify publishes)
  index.html          the whole interface
  data-layer.js       reads and writes to Supabase
  classifier-lens.js  runs a custom trained model in the browser (once one exists)
  config.js           Supabase URL + public anon key
  models/             YOLO11n and YOLO12n, served from our own site
supabase/    database schema and migrations
training/    script for training a classifier on the archive (run in Colab)
docs/        documentation and the data spec
```

## How it works

- Detection runs entirely in the browser with ONNX Runtime Web. Images only leave the device when someone saves them.
- Images are resized to 2048px and saved as JPEG before upload.
- Saved images and labels live in Supabase (Postgres + storage).
- The site is static, so it embeds in the Cargo site as an iframe.

## Deploying

Netlify publishes the `site/` folder (set in `netlify.toml`). Pushing to `main` redeploys once the repo is linked to Netlify.

## Keys

`site/config.js` holds the Supabase **anon** key. That key is meant to be public; row-level security protects the data. Never commit the **service_role** key. It's only used by the training script, as an environment variable.

## Models and license

Detection uses Ultralytics YOLO11 and YOLO12, trained on COCO (80 everyday classes). The ONNX exports come from [nomi30701/yolo-object-detection-onnxruntime-web](https://github.com/nomi30701/yolo-object-detection-onnxruntime-web); YOLO11n and YOLO12n are copied into `site/models/`, and the larger variants load from that repo.

Ultralytics YOLO is licensed AGPL-3.0, so this project is released under AGPL-3.0 as well.
