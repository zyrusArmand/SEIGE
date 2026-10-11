# Prompts to paste into Claude Code, in order

Open Claude Code in this folder, then paste one prompt at a time. Wait until each step works
and you've tested it before moving to the next.

---

## 1. Kickoff and setup

```
Read CLAUDE.md, then everything in docs/, then skim reference/prototype.html.
Summarize the game back to me in 5 bullet points so I know you understand it.
Then help me with Milestone 0: check that Blender 4.2 is installed (find the binary), and walk me
through installing RUN's CLI. I'll paste RUN's official guide when you ask for it.
Don't write game code yet.
```

## 2. Build the 3D assets

```
Run the Blender asset script with previews:
blender -b -P blender/build_assets.py -- --out assets/models --preview
Fix any errors in the script until every asset builds. Then open each preview PNG in
assets/previews and compare it to reference/concept.jpg. Fix anything that looks broken or
off-style, rerunning with --only <name> while you iterate. Show me a list of every asset with
a one-line note on how it looks.
```

## 3. Create the RUN project and load the assets

```
Create the project with RUN's CLI following the guide. Set up Three.js with GLTFLoader inside it
(or RUN's equivalent if their template requires something else). Load castle_frame twice (player
and rival), place a few blocks of each type stacked 1 and 2 high using the stacking rules in
CLAUDE.md, add the bat, pond, trees, and moonlight with shadows, and frame the camera like the
concept art. Tell me how to preview it on my phone.
```

## 4. Core loop (Milestone 1)

```
Port the core loop from reference/prototype.html into the RUN project using the real models:
flight with momentum and banking, moths, building and stacking with the teal square highlights,
loading and dropping rocks with the landing ring, damage and level breaking, completion bars,
timer, win and lose. Put all numbers in src/game/config.js. Add the simple AI rival.
Keep it playable at every step and tell me how to test.
```

## 5. Finish v1 and publish (Milestone 2)

```
Add termites, ghost turrets, the blood moon, and the start and end screens from the spec.
Then walk me through publishing to public on RUN and entering it with "Enter the jam".
```

## 6. Juice pass (Milestone 3)

```
Do the game feel checklist in docs/GAME_SPEC.md: block pop-in, wobble, debris, camera shake,
perfect-hit effects, torch flicker using the TorchSocket empties, moth glow, sounds.
Then do a phone performance pass: tell me the fps and draw calls, and fix anything under 55 fps.
```

## 7. Balance (Milestone 4)

```
Here are my playtest notes: [paste notes]. Suggest specific number changes in config.js,
explain each in one line, apply them, and tell me what to test.
```

---

### If I start adding new ideas

Paste this to yourself first:

```
Before building this, check CLAUDE.md's scope rules. Is the core loop already validated?
If not, add the idea to docs/LATER.md and remind me to finish the current milestone.
```
