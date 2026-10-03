/**
 * 3D Creature Animator — entry point.
 *
 * Gives imported creatures the matching animated 3D model and plays its clips from what happens at the
 * table: attacks and spells from dnd5e's own "activity used" event, flinches and deaths from hit points.
 * No midi-qol, DAE or item macros needed.
 */
import { MODULE_ID, LIB, loadLibrary, matchName, pickModel } from "./library.js";
import {
  onPreCreateActor, onPreCreateToken, onUseActivity, onDamage, onHeal, onPreCreateEffect,
  registerSocket, playEverywhere, rolesFor, setupScene, setupWorldActors, applyModel,
} from "./animator.js";
import { AnimatorApp } from "./app.js";

// Registered at load time so these run before 3D Canvas's own auto-assign (which only knows static minis).
Hooks.on("preCreateActor", (...a) => { try { onPreCreateActor(...a); } catch (e) { console.warn(`${MODULE_ID} |`, e); } });
Hooks.on("preCreateToken", (...a) => { try { onPreCreateToken(...a); } catch (e) { console.warn(`${MODULE_ID} |`, e); } });
Hooks.on("preCreateActiveEffect", (...a) => { try { return onPreCreateEffect(...a); } catch (e) { console.warn(`${MODULE_ID} |`, e); } });

Hooks.once("init", () => {
  const reg = (key, o) => game.settings.register(MODULE_ID, key, { config: true, ...o });
  reg("onImport", { name: "Give imported creatures a model", hint: "When an NPC is created or imported (compendium, 5e.tools, Plutonium…), its token gets the best-matching animated model, idle loop on.", scope: "world", type: Boolean, default: true });
  reg("onPlace", { name: "Give placed tokens a model", hint: "When a creature token is placed without a model, pick one then.", scope: "world", type: Boolean, default: true });
  reg("replaceStatic", { name: "Replace 3D Canvas's static minis", hint: "If 3D Canvas already auto-assigned a static mini from its token compendium, swap it for the animated version when there is one.", scope: "world", type: Boolean, default: true });
  reg("vary", { name: "Vary copies", hint: "When a creature has several matching models (Goblin A, B, C…), each placed token picks one at random.", scope: "world", type: Boolean, default: true });
  reg("includeCharacters", { name: "Include player characters", hint: "Also auto-assign models to player characters. Usually you'll pick those by hand instead.", scope: "world", type: Boolean, default: false });
  reg("playActions", { name: "Play attack and spell clips", hint: "When a creature uses a weapon, feature or spell, play the matching clip, then return to idle.", scope: "world", type: Boolean, default: true });
  reg("playReactions", { name: "Play hurt and death clips", hint: "Flinch when damaged; play the death clip at 0 HP and stay down; stand back up when healed.", scope: "world", type: Boolean, default: true });
  reg("holdDeathPose", { name: "Keep the death pose clean", hint: "Stops the Dead/Prone markers (and the model being tipped over) on creatures whose model has its own death clip. Replaces the skipDead tag.", scope: "world", type: Boolean, default: true });
  reg("extraFolders", { name: "Extra model folders", hint: "More folders of animated .glb models to add to the library, comma-separated (e.g. modules/my-creature-pack, assets/models). Scan them from the Animator window.", scope: "world", type: String, default: "" });
  game.settings.register(MODULE_ID, "extraIndexPath", { scope: "world", config: false, type: String, default: "" });
  reg("useDigiWhenInactive", { name: "Use Digi DM's models even if that module is off", hint: "The models load from its folder either way.", scope: "world", type: Boolean, default: true });
});

Hooks.once("ready", async () => {
  await loadLibrary();
  registerSocket();
  Hooks.on("dnd5e.postUseActivity", (activity) => { onUseActivity(activity); });
  Hooks.on("dnd5e.damageActor", (actor, changes) => { onDamage(actor, changes); });
  Hooks.on("dnd5e.healActor", (actor) => { onHeal(actor); });
  const api = {
    library: LIB, match: matchName, pick: pickModel, roles: rolesFor,
    open: (token) => AnimatorApp.openFor(token?.document ?? token),
    play: (token, index) => { const t = token?.document ?? token; const r = rolesFor(t); playEverywhere(t, index, (r?.list[index]?.dur ?? 1.5) * 1000); },
    setupScene, setupWorldActors, applyModel, reload: loadLibrary,
  };
  game.modules.get(MODULE_ID).api = api;
  console.log(`${MODULE_ID} | ${LIB.models.length} animated models ready`);
});

// A button on the Token HUD
Hooks.on("renderTokenHUD", (hud, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const col = root?.querySelector(".col.right") ?? root?.querySelector(".right");
  const doc = hud.document ?? hud.object?.document;
  if (!col || !doc || col.querySelector(".c3a-hud")) return;
  if (!game.user.isGM && !doc.isOwner) return;
  const b = document.createElement("div");
  b.className = "control-icon c3a-hud";
  b.dataset.tooltip = "3D Creature Animator";
  b.innerHTML = `<i class="fa-solid fa-person-running"></i>`;
  b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); AnimatorApp.openFor(doc); });
  col.append(b);
});
