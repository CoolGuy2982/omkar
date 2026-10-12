# omkar.firley.net

My personal site. Plain static files, no build step.

- `index.html`: page structure and most of the text
- `js/content.js`: projects, awards, and the talk video id
- `js/ocean.js`: the WebGL ocean (ray-marched water, sky, underwater)
- `js/main.js`: renders the content and moves the camera with the scroll
- `js/sound.js`: optional generated ocean sound

To add the AAPT talk video, put the YouTube id in `talkVideo` in `js/content.js`.

## Running locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploying to omkar.firley.net (GitHub Pages)

1. Merge into `main`.
2. In the repo on GitHub: Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`.
3. At the DNS provider for firley.net, add a `CNAME` record: `omkar` → `coolguy2982.github.io`.
4. Back in Settings → Pages, confirm the custom domain shows `omkar.firley.net` (the `CNAME` file sets it) and turn on "Enforce HTTPS" once the certificate is issued.
