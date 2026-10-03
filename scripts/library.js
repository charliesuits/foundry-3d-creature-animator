/**
 * 3D Creature Animator — the model library and name matching.
 *
 * The library is Digi DM's 3D Animations models (shipped as a prebuilt index, so matching is instant)
 * plus any extra folders the GM scans. Each entry knows its clips, so a creature can be animated
 * without ever opening the file.
 */
export const MODULE_ID = "creature-animator-3d";
export const DATA_DIR = `${MODULE_ID}-data`;
export const EXTRA_FILE = "extra-index.json";

export const LIB = { models: [], byPath: new Map(), ready: false };

const dec = (p) => { try { return decodeURIComponent(p ?? ""); } catch { return p ?? ""; } };
export const samePath = (a, b) => dec(a) === dec(b);

// ─────────────────────────────────────────────────────────────── words
const STOP = new Set(["the", "a", "an", "of", "and", "with", "mz4250", "mz4350", "animated", "alt", "new", "male", "female", "version", "v", "model", "3d", "mini", "token", "copy", "npc", "creature"]);
function words(s) {
  return String(s ?? "").toLowerCase()
    .replace(/\(([^)]*)\)/g, " $1 ")
    .replace(/[_\-.,:;'"!?/\\]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w) && w.length > 1)
    .map(singular);
}
function singular(w) {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("ves")) return `${w.slice(0, -3)}f`;
  if (w.length > 3 && w.endsWith("es") && /(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

// ─────────────────────────────────────────────────────────────── loading
function add(m, source) {
  const e = { ...m, source, words: words(m.name), aliasKeys: (m.aliases ?? []).map((a) => a.toLowerCase().trim()) };
  e.roles = clipRoles(e.clips);
  LIB.models.push(e);
  LIB.byPath.set(dec(e.path), e);
}

export async function loadLibrary() {
  LIB.models.length = 0; LIB.byPath.clear();
  const digi = game.modules.get("3d-animations");
  try {
    if (digi && (digi.active || game.settings.get(MODULE_ID, "useDigiWhenInactive"))) {
      const r = await fetch(`modules/${MODULE_ID}/data/digi-index.json`);
      const j = await r.json();
      const present = game.user.isGM ? await filesPresent(j.models) : null;
      let missing = 0;
      for (const m of j.models) {
        if (present && !present.has(dec(m.path))) { missing++; continue; }
        add(m, "3D Animations (Digi DM)");
      }
      LIB.digiMissing = missing;
      if (missing && game.user.isGM) {
        console.warn(`${MODULE_ID} | ${missing} of ${j.models.length} indexed Digi DM models aren't in this copy of 3D Animations — skipped.`);
        if (missing > j.models.length / 4) ui.notifications.warn(`3D Creature Animator: your copy of Digi DM's 3D Animations differs from the built-in index (${missing} models not found). Add modules/3d-animations to "Extra model folders" in this module's settings, then press Scan in the Animator window to pick up your version's models.`, { permanent: true });
      }
    }
  } catch (e) { console.warn(`${MODULE_ID} | could not load the Digi DM index`, e); }
  try {
    const saved = game.settings.get(MODULE_ID, "extraIndexPath");
    const url = saved && /^https?:/.test(saved) ? saved : `${DATA_DIR}/${EXTRA_FILE}`;
    const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) { const j = await r.json(); for (const m of j.models ?? []) if (!LIB.byPath.has(dec(m.path))) add(m, m.source ?? "Scanned folder"); }
  } catch { /* no extra index yet */ }
  LIB.ready = true;
  return LIB;
}

/** Which of these model files exist in this install (null if the folders can't be listed). */
async function filesPresent(models) {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const dirs = [...new Set(models.map((m) => m.path.slice(0, m.path.lastIndexOf("/"))))];
  const found = new Set();
  let listed = 0;
  await Promise.all(dirs.map(async (d) => {
    try { const res = await FP.browse(storageSource(), dec(d)); listed++; for (const f of res.files ?? []) found.add(dec(f)); } catch { /* folder missing or not browsable */ }
  }));
  return listed ? found : null;
}

export const storageSource = () => (globalThis.ForgeVTT?.usingTheForge ? "forgevtt" : "data");

export function modelFor(path) { return path ? LIB.byPath.get(dec(path)) : null; }

// ─────────────────────────────────────────────────────────────── clip roles
/**
 * Sort a model's clips into roles. Clip index = position in the file (that's what 3D Canvas plays).
 * clips: [[name, seconds], …]
 */
export function clipRoles(clips = []) {
  const list = clips.map(([name, dur], i) => ({ i, name, dur: Number(dur) || 1.5, key: String(name).replace(/^\s*\d+\s*[.)-]\s*/, "").toLowerCase().trim() }));
  const find = (re, not) => list.find((c) => re.test(c.key) && !(not && not.test(c.key)));
  const idle = list.find((c) => /^idle\b/.test(c.key)) ?? find(/idle|breath(e|ing)|stand/, /ready/) ?? find(/idle/);
  const stat = find(/static|t-?pose|bind ?pose|rest pose/);
  const react = find(/react|hit|hurt|flinch|pain|stagger|damage(d)?$/);
  const death = find(/death|die|dying|killed|collapse/, /dead/);
  const dead = find(/\bdead\b|corpse/);
  const moveRe = /walk|run|move|fly(ing)?$|swim|crawl|jog|dash|hover|gallop|trot/;
  const skip = new Set([idle, stat, react, death, dead].filter(Boolean).map((c) => c.i));
  // clips that aren't strikes: second hurt clips, eating, climbing, drawing a weapon, perching, transforming…
  const extraRe = /react|hurt|\bhit\b|eat|drink|intimidat|climb|stalagmite|transform|rise|pile|draw|sheath|perch|hover|sleep|\bsit|dance|emote|wave|talk|cheer|taunt|roar|howl|look|sniff|spawn|emerge|burrow|pose|victory|celebrat|laugh|bow idle|ready/;
  const rest = list.filter((c) => !skip.has(c.i) && !moveRe.test(c.key) && !/idle/.test(c.key) && !/eyes open|blink|static/.test(c.key));
  const actions = rest.filter((c) => !extraRe.test(c.key));
  const extras = rest.filter((c) => extraRe.test(c.key));
  // a clip literally called "Attack" is the best default, so it goes first
  actions.sort((x, y) => (/^attack\b|\battack$/.test(y.key) ? 1 : 0) - (/^attack\b|\battack$/.test(x.key) ? 1 : 0) || x.i - y.i);
  const moves = list.filter((c) => moveRe.test(c.key));
  return {
    list, idle: idle?.i ?? (stat ? (list.length > 1 ? (stat.i === 0 ? 1 : 0) : 0) : 0), static: stat?.i ?? null,
    react: react?.i ?? null, death: death?.i ?? null, dead: dead?.i ?? null,
    actions: actions.map((c) => c.i), extras: extras.map((c) => c.i), moves: moves.map((c) => c.i),
  };
}

export function completeness(m) {
  const r = m.roles;
  return (r.idle !== null ? 1 : 0) + (r.react !== null ? 1 : 0) + (r.death !== null ? 1 : 0) + (r.dead !== null ? 1 : 0) + Math.min(2, r.actions.length) * 0.5;
}

// ─────────────────────────────────────────────────────────────── matching
const COLOURS = new Set(["red", "blue", "black", "white", "green", "gold", "golden", "silver", "bronze", "brass", "copper", "platinum", "amethyst", "sapphire", "emerald", "topaz", "crystal", "shadow", "fire", "ice", "frost", "storm", "cloud", "stone", "iron", "clay", "flesh", "magma", "steam", "dust", "water", "earth", "air", "purple", "brown", "snowy", "snow", "polar"]);
const DESCRIPTORS = new Set([...COLOURS, "giant", "young", "adult", "ancient", "elder", "greater", "lesser", "dire", "winter", "swarm", "baby", "huge", "tiny", "deep", "war", "half", "undead", "zombie", "skeleton", "wyrmling"]);
/** Common NPC roles → words that appear in the adventurer/NPC model names. */
const ROLES = {
  mage: "wizard", archmage: "wizard", apprentice: "wizard", wizard: "wizard", sorcerer: "sorcerer", warlock: "warlock",
  priest: "cleric", acolyte: "cleric", cleric: "cleric", paladin: "paladin", knight: "paladin",
  guard: "fighter", veteran: "fighter", soldier: "fighter", thug: "fighter", fighter: "fighter", gladiator: "barbarian", champion: "fighter",
  barbarian: "barbarian", scout: "ranger", ranger: "ranger", druid: "druid", monk: "monk", rogue: "rogue", thief: "rogue", bard: "bard",
  noble: "commoner", commoner: "commoner", peasant: "commoner", villager: "commoner", merchant: "merchant", blacksmith: "blacksmith", barkeep: "barkeep",
};
function baseWord(ws) { return ws.find((w) => !DESCRIPTORS.has(w)) ?? ws[ws.length - 1]; }

/**
 * Best models for a creature name, best first: [{ model, score }].
 * 100 = the name Digi DM's own compendium uses for this model; 90 = same name;
 * 70–60 = every word of the creature is in the model name; ~50 = the model is a more generic version.
 */
export function matchName(name, { min = 40, limit = 12 } = {}) {
  const raw = String(name ?? "").toLowerCase().trim();
  const aw = words(name);
  if (!aw.length) return [];
  const aset = new Set(aw);
  const out = [];
  for (const m of LIB.models) {
    let score = 0;
    if (m.aliasKeys.includes(raw)) score = 100;
    else {
      // a red dragon is never a black dragon
      const ac = aw.filter((w) => COLOURS.has(w)), mc = m.words.filter((w) => COLOURS.has(w));
      if (ac.length && mc.length && !ac.some((w) => mc.includes(w))) continue;
      const mw = m.words;
      if (!mw.length) continue;
      const mset = new Set(mw);
      const aInM = aw.every((w) => mset.has(w));
      const mInA = mw.every((w) => aset.has(w));
      if (aInM && mInA) score = 90;
      else if (aInM) score = 70 - 4 * (mset.size - aset.size);
      else if (mInA) score = 58 - 6 * (aset.size - mset.size);
      else {
        const shared = aw.filter((w) => mset.has(w)).length;
        const jac = shared / new Set([...aw, ...mw]).size;
        // the creature's head noun (usually its last word) must be shared
        if (shared && mset.has(aw[aw.length - 1]) && jac >= 0.34) score = 30 + 30 * jac;
        // same base creature: "Goblin Boss" → a goblin, "Orc War Chief" → an orc
        else if (baseWord(aw) === baseWord(mw) && !ac.length) score = 46 + 4 * jac;
        // a humanoid role: "Mage" → a wizard model, "Guard" → a fighter
        else if (ROLES[aw[aw.length - 1]] && mset.has(ROLES[aw[aw.length - 1]])) score = 44;
      }
    }
    if (score < 90 && m.group === "adventurers") score -= 4;   // loose matches prefer monster/NPC models over PC ones
    if (score >= min) out.push({ model: m, score: score + completeness(m) * 0.5 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Pick one model for a creature. With vary=true, near-equal variants (Goblin A/B/C…) are chosen at random. */
export function pickModel(name, { vary = true, min = 40 } = {}) {
  const res = matchName(name, { min });
  if (!res.length) return null;
  if (!vary) return res[0].model;
  const top = res[0].score;
  const ties = res.filter((r) => r.score >= top - 1.01 && r.score >= 60);
  return (ties.length ? ties[Math.floor(Math.random() * ties.length)] : res[0]).model;
}

/** Is this token model one of 3D Canvas's static auto-matched minis (safe to replace)? */
export function isStaticAutoModel(path) {
  return /canvas3dtokencompendium\/miniatures/.test(dec(path));
}

// ─────────────────────────────────────────────────────────────── scanning extra folders
async function readPrefix(url, n) {
  const res = await fetch(url, { headers: { Range: `bytes=0-${n - 1}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const parts = []; let got = 0;
  while (got < n) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; }
  reader.cancel().catch(() => {});
  const buf = new Uint8Array(Math.min(got, n)); let o = 0;
  for (const p of parts) { const take = Math.min(p.length, buf.length - o); buf.set(p.subarray(0, take), o); o += take; if (o >= buf.length) break; }
  return buf;
}
const td = new TextDecoder();
async function readClips(path) {
  const url = foundry.utils.getRoute(dec(path).split("/").map(encodeURIComponent).join("/"));
  let buf = await readPrefix(url, 65536);
  if (td.decode(buf.subarray(0, 4)) !== "glTF") return null;
  const clen = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(12, true);
  if (20 + clen > buf.length) buf = await readPrefix(url, 20 + clen);
  const j = JSON.parse(td.decode(buf.subarray(20, 20 + clen)));
  const acc = j.accessors ?? [];
  return (j.animations ?? []).map((a) => {
    let d = 0;
    for (const s of a.samplers ?? []) { const mx = acc[s.input]?.max; if (mx) d = Math.max(d, mx[0]); }
    return [a.name ?? "", Math.round(d * 100) / 100];
  });
}

export async function scanFolders(roots, progress = () => {}) {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const files = [];
  for (const root of roots) {
    const queue = [root.replace(/\/$/, "")];
    while (queue.length) {
      const dir = queue.shift();
      let res; try { res = await FP.browse(storageSource(), dir); } catch { continue; }
      for (const f of res.files ?? []) if (/\.glb$/i.test(f)) files.push(f);
      for (const d of res.dirs ?? []) if (!/\/(\.|_to_delete$|thumbnails$)/.test(d)) queue.push(d);
      progress(`Looking in ${dec(dir)} — ${files.length} models so far`);
    }
  }
  const models = [];
  let done = 0;
  const work = [...files];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (work.length) {
      const f = work.shift();
      try {
        const clips = await readClips(f);
        if (clips && clips.length >= 2) {
          const name = dec(f).split("/").pop().replace(/\.glb$/i, "").replace(/^(MZ4[23]50|DigiDM_TurnSheet|Digi_?DM)\s*[-_]\s*/i, "").replace(/[-_\s]*Animated\d*$/i, "").replace(/[_-]+/g, " ").trim();
          const prev = f.replace(/\.glb$/i, ".webp");
          models.push({ path: f, name, group: dec(f).split("/").slice(0, 2).join("/"), aliases: [], preview: files.includes(prev) ? prev : "", clips });
        }
      } catch { /* unreadable file: skip */ }
      progress(`Reading models: ${++done} of ${files.length}`);
    }
  }));
  const FPi = FP;
  const src = storageSource();
  try { await FPi.createDirectory(src, DATA_DIR, {}); } catch { /* exists */ }
  const file = new File([JSON.stringify({ version: 1, scanned: new Date().toISOString(), roots, models })], EXTRA_FILE, { type: "application/json" });
  const res = await FPi.upload(src, DATA_DIR, file, {}, { notify: false });
  if (res?.path) await game.settings.set(MODULE_ID, "extraIndexPath", res.path);
  await loadLibrary();
  return { files: files.length, animated: models.length };
}
