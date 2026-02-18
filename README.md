# Arc Thumbnails — Engineering README

This README describes the Arc Thumbnails demo at the component level. It is intended as a technical reference for developers integrating or running the demo in a local repository. As mentioned in the following youtube video: https://www.youtube.com/watch?v=wFdvBioQ7Ng

Repository layout (example)

- index.html — UI surface and canvas container. Minimal controls: preload count, smooth scale toggle, restart, fit endpoints.
- styles.css — visual defaults for controls and canvas layout.
- script.js — core runtime: image discovery, robust loading, arc path math, animation loop and event handlers.
- manifest.json — optional ordered array of filenames (preferred). If present, script.js loads images exactly in this order. If not present, the script falls back to parsing the directory HTML listing produced by simple static servers (e.g., `python3 -m http.server`).

Example local folder for preview

Place the files and images together in a single folder for local preview, for example:

  ./thumbs/
    index.html
    styles.css
    script.js
    manifest.json   # optional
    image1.png
    image2.png
    ...

Run locally

1. Change to the folder containing the files and images.
2. Start a simple HTTP server:

   python3 -m http.server 8008

3. Open http://localhost:8008 in a browser and inspect DevTools (Network & Console) for issues.

Design goals

- Deterministic ordering when manifest.json is used.
- Robust loading pipeline that prioritizes efficient decoding (ImageBitmap + resize hints), with fallbacks to Image + ObjectURL.
- Path geometry defined by explicit Start/End percent coordinates so endpoints remain visible on varied window sizes.
- Configurable preload count and scaling behavior (smooth or discrete milestones).

Component-level descriptions

index.html
- Hosts the control bar and canvas element with id="stage".
- Controls: preload count (number), smooth scale toggle (checkbox), Restart, Fit Endpoints.
- Interaction: Shift+click on canvas sets the Start endpoint; Alt/Ctrl+click sets the End endpoint.

styles.css
- Provides layout for controls and canvas container. Optional but recommended to maintain consistent height and spacing.

manifest.json
- Preferred source of filenames. Structure: a JSON array of strings.
- Example:

  [
    "image1.png",
    "image2.png",
    "subdir/image3.png"
  ]

- Entries may be plain filenames (the loader prefixes './') or relative/absolute URLs. The loader normalizes entries before fetching.

script.js — functions and behavior

High-level flow
- On window load: resize canvas and call startDemo().
- startDemo(): obtain image list (manifest or directory), load up to N images (preload count), initialize items, and start the animation loop.

fetchImageList()
- Attempts to fetch './manifest.json' (no-cache) first. If present and valid, returns a normalized array of relative URLs.
- If manifest.json is missing or invalid, falls back to parsing the server-generated directory index HTML (works with `python3 -m http.server`).

normalizeEntryToUrl(entry)
- Trims the entry, leaves http(s) or data URLs unchanged, prefixes './' for bare filenames so fetch('./name.png') resolves to same directory.

loadImagesFromList(list, limit)
- For each entry (up to limit): fetch as blob. Prefer createImageBitmap(blob, {resizeWidth, resizeHeight}) to get a resized ImageBitmap when supported.
- If resize fails or ImageBitmap is not available, fall back to createImageBitmap(blob) or Image() + ObjectURL with img.decode().
- Revoke object URLs after decode to free memory.
- Log warnings for fetch or decode failures.

initItemsFromImages(imgs)
- Converts decoded images into animation items: { img, t, duration, delay, startedAt }.
- Starts the requestAnimationFrame loop.

computePosOnArc(t, w, h)
- Computes position and tangent along a quadratic Bezier defined by P0 (Start), P1 (End), and C (midpoint offset perpendicular to P0→P1).
- Start and End are defined as percentages of canvas size to ensure visibility.
- Returns { x, y, ang } where ang is the tangent angle (optional rotation use).

getScaleForProgress(progress)
- Two modes: smooth (linear interpolation from START_SCALE to 1.0) or milestone (discrete steps controlled by MILESTONE_STEPS).

update(dt) and draw()
- update(dt): advances each item's normalized progress parameter t and wraps when exceeding the end.
- draw(): clears canvas, draws an optional guide curve, sorts items by progress, computes position/scale and draws each image with shadow and alpha.

User API and interactions
- Shift+click sets the Start endpoint; Alt/Ctrl+click sets the End endpoint.
- Exposed JS API: `window.ArcThumb.startDemo()` and `window.ArcThumb.setEndpoints(sx,sy,ex,ey,heightFactor)`.

Features and edge cases

- Deterministic ordering: use manifest.json to guarantee the order of images.
- Fallback behavior: directory listing parsing for simple static servers.
- Large images: script attempts to use createImageBitmap resize hints; browser support varies. For consistent performance, pre-generate 128×128 thumbnails and reference those in the manifest.
- Placeholders: placeholders are used only when no images are discovered.
- Debugging: network and decode failures log helpful warnings in the console with the request URL and HTTP status.

Manifest generation example (Python)

To auto-generate a manifest.json from the current directory (example):

  # run inside the images directory
  python3 - <<PY
  import os, json
  files = sorted([f for f in os.listdir('.') if f.lower().endswith(('.png','.jpg','.jpeg'))])
  with open('manifest.json', 'w') as fh:
      json.dump(files, fh, indent=2)
  print('Wrote manifest.json with', len(files), 'entries')
  PY

Troubleshooting checklist

- No images appear (placeholders only):
  - Confirm manifest.json is served from the same directory as index.html and images (open http://localhost:8008/manifest.json).
  - Check DevTools Network for failed image fetches (404) or decode errors.
  - Verify manifest filenames exactly match files (case-sensitive on some systems).

- decode/createImageBitmap errors:
  - Open the image directly in a browser tab to validate the file.
  - Re-encode or create thumbnails if the image is very large or corrupted.

- Memory/performance issues:
  - Reduce preload count.
  - Pre-generate thumbnails on disk and reference those in manifest.json.
  - Rely on createImageBitmap resize where supported, but do not assume it is available in all browsers.

Customization and tuning

- FINAL_SIZE (script.js) controls target thumbnail pixel dimension.
- travelDuration and stagger (initItemsFromImages) control speed and spacing.
- arcHeightFactor controls bow height. Smaller values create a flatter path.
- MILESTONE_STEPS controls discrete scaling granularity (e.g., 20 -> 5% steps).

Developer notes

- Primary entrypoints: index.html and script.js. The demo assumes a simple static server capable of serving manifest.json and image files.
- To integrate the arc into another app, import or adapt the computePosOnArc, loadImagesFromList and drawing logic and call through the exposed API to control endpoints.

