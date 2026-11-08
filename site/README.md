# Spoken landing page

Static site for spoken.hellosverre.com. Plain HTML/CSS/JS, no build step; deploy this folder as-is (Vercel: root directory `site`, no framework, no build command).

Run locally:

```bash
python3 -m http.server 4391 --directory site
```

- `index.html` holds the Norwegian copy; `main.js` holds the English strings (`EN`) and swaps them in. `?lang=en` opens in English.
- `shots/` are real screenshots of the app's scripted demo call at 390 px, 2x, per language and theme: `<no|en>-<dark|light>-<home|plan|live|approve|done>.webp`.
- Fonts: Inter variable (OFL), latin subset, self-hosted in `fonts/`.
