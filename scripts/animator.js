/**
 * 3D Creature Animator — wiring tokens to models and playing clips.
 *
 * Resting poses (idle, dead) are saved on the token as 3D Canvas's own animIndex flag, so they survive
 * reloads. One-off clips (attacks, flinches) are played straight into each client's 3D scene and then
 * handed back to the resting pose — no database writes, nothing for other modules to trip over.
 */
import { MODULE_ID, LIB, modelFor, pickModel, clipRoles, isStaticAutoModel } from "./library.js";

const L3D = "levels-3d-preview";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const setting = (k) => game.settings.get(MODULE_ID, k);

// ─────────────────────────────────────────────────────────────── roles for a token
/** Clip roles for a token: from the index when we know the model, otherwise read live from 3D Canvas. */
export function rolesFor(tokenDoc) {
  const path = tokenDoc?.getFlag?.(L3D, "model3d") ?? tokenDoc?.flags?.[L3D]?.model3d;
  const m = modelFor(path);
  if (m) return m.roles;
  const live = game.Levels3DPreview?.tokens?.[tokenDoc?.id]?.mixerAnimations;
  if (live?.length) return clipRoles(live.map((c) => [c.name, c.duration]));
  return null;
}

/** The flags that make a token use a model with its idle loop running. */
export function modelFlags(model) {
  return {
    model3d: model.path,
    enableAnim: true,
    animIndex: model.roles.idle ?? 0,
    animSpeed: 1,
  };
}

// ─────────────────────────────────────────────────────────────── set up on import / placement
function wantsModel(flags) {
  const cur = flags?.[L3D]?.model3d;
  if (!cur) return true;
  return isStaticAutoModel(cur) && setting("replaceStatic");
}
function isCreature(actor) { return actor && (actor.type === "npc" || (actor.type === "character" && setting("includeCharacters"))); }

/** preCreateActor: an imported creature gets its model before it is even saved. */
export function onPreCreateActor(actor, data, options, userId) {
  if (userId !== game.userId || !setting("onImport") || !LIB.ready) return;
  if (!isCreature(actor)) return;
  if (!wantsModel(actor.prototypeToken?.flags)) return;
  const m = pickModel(actor.name, { vary: false });
  if (!m) return;
  actor.updateSource({ prototypeToken: { flags: { [L3D]: modelFlags(m), [MODULE_ID]: { auto: true } } } });
}

/** preCreateToken: a token placed from an actor that was never set up. */
export function onPreCreateToken(tokenDoc, data, options, userId) {
  if (userId !== game.userId || !setting("onPlace") || !LIB.ready) return;
  const actor = tokenDoc.actor;
  if (!isCreature(actor)) return;
  const flags = tokenDoc.flags;
  if (!wantsModel(flags)) {
    // already has a library model: give this copy its own variant (Goblin A/B/C…) if allowed
    const cur = modelFor(flags?.[L3D]?.model3d);
    if (cur && setting("vary") && flags?.[MODULE_ID]?.auto) {
      const v = pickModel(actor.name, { vary: true });
      if (v && v.path !== cur.path) tokenDoc.updateSource({ flags: { [L3D]: modelFlags(v) } });
    }
    return;
  }
  const m = pickModel(tokenDoc.name || actor.name, { vary: setting("vary") }) ?? pickModel(actor.name, { vary: setting("vary") });
  if (!m) return;
  tokenDoc.updateSource({ flags: { [L3D]: modelFlags(m), [MODULE_ID]: { auto: true } } });
}

/** Give an existing token (and optionally its actor's prototype) a model. */
export async function applyModel(tokenDoc, model, { prototype = false } = {}) {
  await tokenDoc.update({ flags: { [L3D]: modelFlags(model), [MODULE_ID]: { auto: false } } });
  if (prototype) {
    const base = game.actors.get(tokenDoc.actorId);
    if (base) await base.update({ prototypeToken: { flags: { [L3D]: modelFlags(model), [MODULE_ID]: { auto: false } } } });
  }
}

/** Set up every token on a scene that has no model yet (or only a static auto-matched one). */
export async function setupScene(scene = canvas.scene) {
  const ups = [];
  for (const t of scene.tokens) {
    if (!isCreature(t.actor) || !wantsModel(t.flags)) continue;
    const m = pickModel(t.name || t.actor.name, { vary: setting("vary") });
    if (m) ups.push({ _id: t.id, flags: { [L3D]: modelFlags(m), [MODULE_ID]: { auto: true } } });
  }
  if (ups.length) await scene.updateEmbeddedDocuments("Token", ups);
  return ups.length;
}

/** Set up every NPC actor in the world whose prototype token has no model. */
export async function setupWorldActors(progress = () => {}) {
  const ups = [];
  for (const a of game.actors) {
    if (!isCreature(a) || !wantsModel(a.prototypeToken?.flags)) continue;
    const m = pickModel(a.name, { vary: false });
    if (m) ups.push({ _id: a.id, prototypeToken: { flags: { [L3D]: modelFlags(m), [MODULE_ID]: { auto: true } } } });
  }
  for (let i = 0; i < ups.length; i += 50) { await Actor.implementation.updateDocuments(ups.slice(i, i + 50)); progress(Math.min(ups.length, i + 50), ups.length); }
  return ups.length;
}

// ─────────────────────────────────────────────────────────────── playing
const busy = new Map();   // token id -> timeout handle for returning to rest

/** Play clip `index` on this client for `ms`, then return to the token's saved resting pose. */
export function playLocal(tokenId, index, ms) {
  const t3 = game.Levels3DPreview?._active ? game.Levels3DPreview.tokens?.[tokenId] : null;
  if (!t3?.mixer || !t3.mixerAnimations?.[index]) return false;
  const clip = t3.mixerAnimations[index];
  const next = t3.mixer._actions.find((a) => a._clip.uuid === clip.uuid) ?? t3.mixer.clipAction(clip);
  const curr = t3.mixer._actions.find((a) => a.isRunning() && a !== next);
  next.reset(); next.enabled = true;
  if (curr) curr.crossFadeTo(next, 0.2).play(); else next.play();
  clearTimeout(busy.get(tokenId));
  busy.set(tokenId, setTimeout(() => { busy.delete(tokenId); try { t3.updateAnimation(); } catch { /* token gone */ } }, Math.max(300, ms)));
  return true;
}

/** Play a clip for everyone. */
export function playEverywhere(tokenDoc, index, ms) {
  if (index === null || index === undefined) return;
  playLocal(tokenDoc.id, index, ms);
  game.socket.emit(`module.${MODULE_ID}`, { t: "play", scene: tokenDoc.parent?.id, token: tokenDoc.id, index, ms });
}

export function registerSocket() {
  game.socket.on(`module.${MODULE_ID}`, (msg) => {
    if (msg?.t === "play" && msg.scene === canvas.scene?.id) playLocal(msg.token, msg.index, msg.ms);
  });
}

/** Tokens on the current scene for an actor (a synthetic actor has exactly one). */
function tokensOf(actor) {
  if (!actor || !canvas.scene) return [];
  if (actor.isToken) return actor.token?.parent === canvas.scene ? [actor.token] : [];
  return actor.getActiveTokens(true, true).filter((t) => t.parent === canvas.scene);
}
const animated = (t) => t.getFlag(L3D, "enableAnim") && t.getFlag(L3D, "model3d");

// ─────────────────────────────────────────────────────────────── which clip for an item
const HINTS = [
  [/bow|crossbow|arrow|bolt|sling|shoot|shot|dart|javelin|throw|hurl|rock|spit|spray|ranged/, /shoot|bow|throw|rock|spit|spray|ranged|shot|hurl|fire/],
  [/breath|cone of|exhale/, /breath|exhale|spray|fire|roar|hover|fly/],
  [/claw|talon|rake|scratch/, /claw|rake|swipe|slash/],
  [/bite|fang|maw|jaw|gore/, /bite|chomp|maw|gore/],
  [/tail/, /tail|sweep/],
  [/slam|fist|punch|unarmed|strike|club|mace|hammer|maul|flail|morningstar|grasp|touch/, /slam|fist|punch|smash|grasp|grab|strike|attack/],
  [/hoof|hooves|kick|stomp|trample/, /kick|stomp|hoof|trample|buck/],
  [/sword|scimitar|rapier|axe|dagger|blade|glaive|halberd|scythe|sickle|cleaver|kukri/, /sword|slash|swing|attack|stab|axe|dagger|blade/],
  [/spear|pike|lance|trident|stinger|sting|horn|tusk|ram|charge/, /spear|thrust|stab|sting|horn|ram|charge|gore/],
  [/frightful|presence|roar|howl|shriek|scream|screech|wail|leadership|command/, /roar|howl|shriek|scream|screech|taunt|shout/],
  [/web|net|entangle/, /web|net|throw|spit/],
  [/tentacle|tendril|reel|constrict|grapple|engulf|swallow|lash/, /tentacle|tendril|grab|constrict|grapple|engulf|swallow|lash/],
];

function clipKey(roles, i) { return roles.list[i]?.key ?? ""; }

/** Choose the clip for an item/activity: saved choice → name match → hint → spell cast → rotation. */
export function clipForItem(tokenDoc, item, activity, { rotate = true, ignoreSaved = false } = {}) {
  const roles = rolesFor(tokenDoc);
  if (!roles || !(roles.actions.length || roles.extras?.length)) return null;
  const all = [...roles.actions, ...(roles.extras ?? []), ...(roles.moves ?? [])];
  const saved = ignoreSaved ? null : item.getFlag(MODULE_ID, "clip");
  if (saved === "none") return null;
  if (saved) {
    const hit = roles.list.find((c) => c.key === String(saved).toLowerCase());
    if (hit) return hit.i;
  }
  const iname = item.name.toLowerCase();
  const iw = iname.split(/[^a-z]+/).filter((w) => w.length > 2);
  // 1. a clip named after the item ("Bite" → "2. Bite", "Rock Throw" → "2. Rock Throw")
  let best = null, bestScore = 0;
  for (const i of all) {
    const k = clipKey(roles, i);
    const shared = iw.filter((w) => k.includes(w) || k.includes(w.replace(/s$/, ""))).length;
    if (shared > bestScore) { bestScore = shared; best = i; }
  }
  if (best !== null) return best;
  // 2. spells and magic → a casting clip
  const isSpell = item.type === "spell" || /spell|cast|magic|bolt|ray|blast/.test(iname);
  if (isSpell) { const c = roles.actions.find((i) => /cast|spell|magic|channel|conjure|summon/.test(clipKey(roles, i))); if (c !== undefined) return c; }
  // 3. what kind of attack it is
  const ranged = activity?.attack?.type?.value === "ranged" || /ranged/.test(activity?.actionType ?? "");
  for (const [itemRe, clipRe] of HINTS) {
    if (!itemRe.test(iname) && !(ranged && itemRe === HINTS[0][0])) continue;
    // earlier words in the hint win: a fist prefers "Grasp"/"Slam" over a generic "Attack"
    for (const alt of clipRe.source.split("|")) {
      const re = new RegExp(alt);
      const c = all.find((i) => re.test(clipKey(roles, i)));
      if (c !== undefined) return c;
    }
  }
  if (!roles.actions.length) return null;
  // 4. rotate through the creature's attacks so a multiattack looks varied
  const plain = roles.actions.filter((i) => !/cast|spell|roar|howl|taunt|shriek|scream|breath/.test(clipKey(roles, i)));
  const pool = (isSpell ? roles.actions : plain.length ? plain : roles.actions);
  if (!rotate) return pool[0];
  const n = (rotation.get(tokenDoc.id) ?? -1) + 1;
  rotation.set(tokenDoc.id, n);
  return pool[n % pool.length];
}
const rotation = new Map();

/** dnd5e.postUseActivity — the creature attacks, casts or uses a feature. */
export function onUseActivity(activity) {
  try {
    if (!setting("playActions")) return;
    const item = activity?.item;
    const actor = item?.actor;
    if (!actor) return;
    if (midiHandles(item)) return;
    const controlled = canvas.tokens?.controlled?.map((t) => t.document).filter((t) => t.actor === actor || t.actorId === actor.id);
    const toks = (controlled?.length ? controlled : tokensOf(actor)).filter(animated);
    for (const t of toks) {
      const i = clipForItem(t, item, activity);
      if (i === null || i === undefined) continue;
      const roles = rolesFor(t);
      playEverywhere(t, i, (roles.list[i]?.dur ?? 1.5) * 1000);
    }
  } catch (e) { console.warn(`${MODULE_ID} | could not play an action`, e); }
}

/** If midi-qol is running Digi DM's own item macros for this item, leave it to them. */
function midiHandles(item) {
  if (!game.modules.get("midi-qol")?.active) return false;
  const on = item.getFlag?.("midi-qol", "onUseMacroName") ?? "";
  return /ItemMacro/.test(on) && /animIndex/.test(item.getFlag?.("dae", "macro")?.command ?? "");
}
function midiHandlesDeath(actor) {
  if (!game.modules.get("midi-qol")?.active) return false;
  return actor.items.some((i) => /death/i.test(i.name) && /animIndex/.test(i.getFlag?.("dae", "macro")?.command ?? ""));
}

// ─────────────────────────────────────────────────────────────── hurt, death, revival
/** dnd5e.damageActor — fires on every client, so each plays the flinch itself. */
export async function onDamage(actor, changes) {
  if (!setting("playReactions") || changes.hp >= 0 || midiHandlesDeath(actor)) return;
  const hp = actor.system?.attributes?.hp?.value ?? 1;
  for (const t of tokensOf(actor).filter(animated)) {
    const roles = rolesFor(t);
    if (!roles) continue;
    if (hp <= 0 && roles.death !== null) {
      // everyone sees the fall; the active GM saves the final pose so it survives a reload
      const ms = (roles.list[roles.death]?.dur ?? 2) * 1000;
      clearTimeout(busy.get(t.id));
      playLocal(t.id, roles.death, ms + 5000);
      if (game.users.activeGM?.isSelf) {
        await wait(Math.max(400, ms - 150));
        const rest = roles.dead ?? roles.death;
        if (t.getFlag(L3D, "animIndex") !== rest) await t.setFlag(L3D, "animIndex", rest);
        await t.setFlag(MODULE_ID, "down", true);
      }
    } else if (hp > 0 && roles.react !== null) {
      playLocal(t.id, roles.react, (roles.list[roles.react]?.dur ?? 1) * 1000);
    }
  }
}

/** dnd5e.healActor — brought back from 0: stand back up into the idle loop. */
export async function onHeal(actor) {
  if (!game.users.activeGM?.isSelf) return;
  const hp = actor.system?.attributes?.hp?.value ?? 0;
  if (hp <= 0) return;
  for (const t of tokensOf(actor).filter(animated)) {
    if (!t.getFlag(MODULE_ID, "down")) continue;
    const roles = rolesFor(t);
    await t.update({ flags: { [L3D]: { animIndex: roles?.idle ?? 0 }, [MODULE_ID]: { down: false } } });
  }
}

// ─────────────────────────────────────────────────────────────── keep the death pose clean
/** Stop dnd5e laying a Dead/Prone marker (and flipping the model) over a creature that has its own death animation. */
export function onPreCreateEffect(effect, data) {
  if (!setting("holdDeathPose")) return;
  const statuses = new Set(data.statuses ?? effect.statuses ?? []);
  const name = data.name ?? effect.name;
  const dead = statuses.has("dead") || name === "Dead";
  const prone = statuses.has("prone") || name === "Prone";
  const unconscious = statuses.has("unconscious") || name === "Unconscious";
  if (!dead && !prone && !unconscious) return;
  const actor = effect.parent;
  if (!(actor instanceof Actor)) return;
  if ((actor.system?.attributes?.hp?.value ?? 1) > 0) return;
  const tok = tokensOf(actor).find(animated);
  if (!tok) return;
  const roles = rolesFor(tok);
  if (!roles || roles.death === null) return;
  if (dead || prone) return false;
  if (unconscious && actor.type === "character") return false;
}
