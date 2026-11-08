# Pitch opener

`intro.html` is one self-contained file (font, logo and app capture inlined; works from `file://` offline).

| Key | Action |
|---|---|
| Click / Space / → / Enter | Play: title slide → flowing strands → pens trace the app → real screen (~7.2 s) |
| R | Reset to the title slide |
| F | Jump to the final frame (stage fallback) |

`?auto=1` plays 1.2 s after load. `prefers-reduced-motion` gets a plain crossfade.

Rebuild after editing `tools/intro.src.html`:

```bash
node pitch/tools/build.mjs
```

Key frames into `pitch/frames/` (needs a Chromium; on NixOS pass `CHROME=/path/to/chrome`):

```bash
node pitch/tools/capture.mjs
```

`reference-title-slide.html` is Sverre's original slide, kept as the start-state reference.
