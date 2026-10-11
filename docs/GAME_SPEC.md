# Bat Siege — game spec

All numbers are starting values from `reference/prototype.html`. Tune them through playtesting and
keep them in one config file (`src/game/config.js`) so balance changes are one-line edits.

## The match

- 1 player vs 1 AI rival bat. One match = **3:00**.
- Each side has a castle with a **6 wide x 3 deep grid** (18 squares). Player castle is at the bottom
  of the screen, rival castle at the top, open field with moths between them.
- **Castle completion** = total block levels / 36 (every square stacked 2 high = 100%).
- **Win:** reach 100% first. **Time up:** higher completion wins; equal = stalemate.
- Both castles start with the same 8 level-1 blocks (mirrored), about 22% built.

## Moths (currency)

- Glowing orange moths flutter over the field. Fly through one to eat it (+1 moth).
- Spawn every 0.8–1.3 s, max 12 on the field, inside x ±5.4, z ±3.9, never over the pond.
- **Comeback rule:** spawns drift toward the losing side (offset z by -lead x 7, clamped).
- Blood moon: spawn every 0.6 s.

## Building (only while your bat is over your own castle)

| Block | Cost | HP per level | Look | Notes |
|---|---|---|---|---|
| Wood | 1 | 40 | orange planks, gable roof cap | cheap filler |
| Stone | 3 | 100 | grey bricks, crenellated cap | tank |
| Bone | 3 | 70 | cream bone bricks, skull emblem, horned dome cap | heals the 4 adjacent blocks 2 HP/s |

- Select a block in the tray, then tap a glowing square. Placing the same type on a level-1 square
  stacks it to level 2 (adds that type's HP). You can't mix types on one square. Max level 2.
- Squares you can build on glow teal (dashed outline). The hovered square glows brighter.
- When the bat leaves home, the status line says "Away. Building paused."

## Attacks (load at home, drop over the rival)

| Attack | Cost | Effect |
|---|---|---|
| Rock | 2 | 60 damage to the block it lands on |
| Termites | 3 | infest the block: 3 damage/s for 30 s, with a floating countdown |

- Tap Rock or Termites while home to load it. The bat carries it underneath (visible).
- A **landing ring** on the ground/blocks shows where it will land. It accounts for momentum:
  landing = position + velocity x 0.6 x fall time. Ring colors: teal = nothing there,
  orange = over a rival block, pale gold = dead center.
- Tap **Drop!** (or Space). **Perfect hit:** within 0.38 of the square's center = x1.5 damage
  (termites 4.5/s), gold "Perfect!" text, chime, sparkles.
- Damage removes levels: when HP falls to the level below, the top level breaks off with debris.
  At 0 HP the block is destroyed.
- Missing (empty square or open ground) shows "Miss" and a dust puff. No friendly fire.

## Ghost turret (defense)

- Each castle has one ghost floating over a back-corner square (player: col 0 row 2; rival: col 5
  row 0). It works only while a block exists under it. Destroy that block and the ghost fades out.
- Fires a homing purple orb at the enemy bat when within 7.2 units, every 2.0–2.6 s.
  Orb speed 5.2, steering, 2.6 s life.
- Hit: bat is stunned 1.2 s (spins, sinks, can't steer), **drops its cargo** where it is,
  and loses 1 moth. "Ghosted!" text.

## Blood moon (last 30 s)

- Moonlight shifts to red over 3 s, pond reflection turns red, timer turns red.
- Banner: "Blood moon. Every attack does double damage." Low rumble sound.
- All damage x2, moth spawns faster.

## Controls

- **Touch/mouse:** tap or drag anywhere to fly toward that point (the bat steers with momentum
  and banks into turns). When a block is selected and the bat is home, tapping a castle square builds
  instead of flying.
- **Keyboard:** WASD/arrows fly, Space drops, 1–5 select tray buttons.
- Bat max speed 6.6 (AI 5.6), acceleration 4.5, flies at height 2.8 with a gentle bob.

## AI rival

Decides every 0.6–1.1 s:
- **Gather:** fly to the nearest moth (prefers moths on its own half).
- **Build** when it has 4+ moths and is behind or about even, or has 7+ moths: fly home, place one
  block every 0.55 s (prefers empty squares, then stacking; picks stone/bone 50% when it can afford
  them, else wood) until broke.
- **Raid** when it has 2+ moths and leads by 8%+, or by coin flip: load a rock (or termites 40% when
  it has 3+), pick a target (highest-level block, bonus for the player's turret block), fly over it,
  slow down, drop when within 0.35.
- Its ghost turret and the player's work the same way.

## UI (see ART_GUIDE for styling)

- **Top:** "Your Castle" teal bar + % (left), moth counter with moth icon (center) and timer chip
  below it, "Rival Bat" orange bar + % (right).
- **Bottom:** status line, then a glass tray with 5 buttons: Wood 1, Stone 3, Bone 3, Rock 2,
  Termites 3 (cost badge bottom-right). Unaffordable buttons dim. Selected build button lifts and
  glows. Wrong taps shake the button and show a short toast with the reason.
- **Drop!** button appears above the status line only while carrying.
- Floating combat text over the world (+1, -60, Perfect!, Miss, Termites!, Ghosted! -1).
- Termite countdown label floats above infested blocks.
- Mute button top-right.
- **Start screen:** title, one-line pitch, 3 numbered steps, Play button.
- **End screen:** Victory / Defeated / Stalemate, stats (moths eaten, blocks smashed, perfect drops),
  Play again. Later: RUN leaderboard for win streak or fastest win (only after the core is fun).

## Game feel checklist ("juice")

- New block pops in (squash and stretch, 0.35 s) with a puff of colored debris.
- Hit blocks wobble; broken levels throw chunky debris that bounces and fades.
- Camera shake: big for rock impacts near you, small otherwise. Respect reduced-motion settings.
- Bat banks into turns, wings flap faster at speed, shadow always visible (it's the aiming aid).
- Torches flicker. Moths glow and pulse. Ghost bobs and turns to face the enemy bat.
- Bone blocks emit small green sparkles when healing a neighbor.

## Audio (synthesized now, can be replaced with real samples later)

moth pickup (rising blip), wood knock, stone knock, load (two-tone), drop whoosh, smash (thump +
noise), perfect (two-note chime), termite chomp clicks, ghost zap, bat hit, error buzz,
blood moon rumble, win arpeggio up, lose arpeggio down. Audio starts after the first tap.

## Not in v1 (park in docs/LATER.md)

Multiplayer, more block or attack types, upgrades, unlocks, skins, story, multiple maps, daily
challenges. Revisit only after the core loop is validated and v1 is published.
