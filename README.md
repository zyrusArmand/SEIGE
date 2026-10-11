# Bat Siege

Mobile-first 3D strategy-action game for the RUN October Jam (theme: Monster Mash).
You're a bat defending a block castle: eat glowing moths, build wood/stone/bone blocks at home,
and raid the rival bat by dropping rocks and termites. While you're away, your castle can't grow.

## Play it locally

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install        # first time only
npm run dev        # starts the game; open the "Network" link on your phone (same Wi-Fi)
```

- Add `?debug` to the URL to see fps, draw calls and triangle count.
- Phones automatically lower resolution/shadows if they can't hold ~48 fps (`?hq` turns that off).
- Desktop gets a soft bloom on glowing things; `?bloom=0` / `?bloom=1` force it off/on.
- First-match hints are remembered in localStorage (`batSiegeTutorialDone`); clear it to see them again.
- `npm run build` makes the upload-ready game in `dist/` (about 3 MB).
- `npm run simulate` plays 40 matches headlessly (a simple bot vs. the AI) and prints results.
  Handy after changing numbers in `src/game/config.js`.

## Controls

- **Touch/mouse:** tap or drag to fly. With a block selected and the bat home, tap a glowing square to build.
- **Keyboard:** WASD/arrows fly, Space drops, 1–5 pick tray buttons, Esc deselects, M mutes.

## Where things live

| Path | What |
|---|---|
| `src/game/config.js` | every gameplay number (costs, HP, timers, AI) |
| `src/game/game.js` | game rules, AI, no rendering |
| `src/render/` | Three.js: world, castles (instanced blocks), actors, effects |
| `src/audio.js` | synthesized sound effects + night ambience |
| `blender/build_assets.py` | builds every 3D model, see below |
| `assets/models/` | generated `.glb` models (served to the game as static files) |
| `assets/previews/` | preview renders of each model |
| `reference/` | original prototype and concept art |

## Rebuilding the 3D models

```bash
blender -b -P blender/build_assets.py -- --out assets/models --preview
```

No Blender install? The script also runs with the `bpy` Python module (Blender 5.1 as a library,
Python 3.13):

```bash
python3.13 -m venv .bpy && .bpy/bin/pip install bpy==5.1.2
.bpy/bin/python blender/build_assets.py -- --out assets/models --preview
```

Use `--only bat_player,rock` to rebuild just some models.

## Publishing to RUN

Not wired up yet: RUN's CLI guide (events.run.world/events/octoberjam → "Open the full guide")
is needed first. The game is a plain Vite + Three.js web app with relative paths (`base: './'`),
so `dist/` should drop into RUN's web template.
