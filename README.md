# 3D Creature Animator

Makes Digi DM's animated 3D models come alive for any creature, without midi-qol, DAE or item macros.

- **On import:** an NPC created or imported from anywhere gets the best-matching animated model with its idle loop running. Copies (Goblin A/B/C…) vary.
- **Attacks and spells:** when a creature uses a weapon, feature or spell, the matching clip plays ("Bite" → Bite, bows → Shoot, spells → Cast), then it returns to idle.
- **Hurt and death:** a flinch when damaged, the death clip at 0 HP ending on the dead pose, and back up to idle when healed. The Dead/Prone markers are held off creatures with their own death clip (replaces the skipDead tag).
- **Token HUD button:** see the model and its clips, play any clip for the table, set the resting pose, change the model from a searchable picture grid, and choose which clip each action plays.
- **Whole table:** set up every creature on a scene, or every NPC in the world, in one click. Add more animated model folders in the settings and scan them.

### Requirements
- **3D Canvas** (levels-3d-preview).
- **Digi DM's 3D Animations** for the built-in model list. The module ships an index of that pack's models and clips, and checks it against your copy when the world loads. If your version is different, it tells you; add `modules/3d-animations` under **Extra model folders** and press **Scan** in the Animator window to read your version directly.
- Any other folder of animated `.glb` models works too: add it under **Extra model folders** and scan it.
- D&D 5e system 4.0 or later (tested on 6.0.5).

## Installing

In Foundry, go to **Add-on Modules → Install Module**, paste this manifest URL and click **Install**:

```
https://github.com/charliesuits/foundry-3d-creature-animator/releases/latest/download/module.json
```

Then enable it in your world under **Manage Modules**. Foundry will offer updates automatically when a new version is released.

Works with Foundry VTT v13 and v14.

## License

MIT
