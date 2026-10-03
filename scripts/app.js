/**
 * 3D Creature Animator — the per-token window (opened from the Token HUD).
 */
import { MODULE_ID, LIB, modelFor, matchName, scanFolders, samePath } from "./library.js";
import { rolesFor, applyModel, playEverywhere, clipForItem, setupScene, setupWorldActors } from "./animator.js";

const HAM = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const L3D = "levels-3d-preview";
const ROLE = { idle: "Idle", react: "Hurt", death: "Death", dead: "Dead", static: "Still" };

export class AnimatorApp extends HAM {
  static DEFAULT_OPTIONS = {
    classes: ["c3a-app"],
    tag: "div",
    window: { title: "3D Creature Animator", icon: "fa-solid fa-person-running", resizable: true },
    position: { width: 640, height: 700 },
  };
  static PARTS = { content: { template: `modules/${MODULE_ID}/templates/host.hbs` } };

  static openFor(tokenDoc) {
    const id = `c3a-${tokenDoc.id}`;
    const cur = foundry.applications.instances.get(id);
    if (cur) { cur.bringToFront(); return cur; }
    const app = new AnimatorApp(tokenDoc, { id });
    app.render({ force: true });
    return app;
  }

  constructor(tokenDoc, options = {}) {
    super(options);
    this.tokenDoc = tokenDoc;
    this.picking = false;
    this.q = "";
    this._hook = null;
  }

  get title() { return `3D Animator — ${this.tokenDoc.name}`; }

  _onRender(context, options) {
    super._onRender(context, options);
    const host = this.element.querySelector(".c3a-host");
    if (!host.dataset.bound) {
      host.dataset.bound = "1";
      host.addEventListener("click", (e) => this.onClick(e));
      host.addEventListener("change", (e) => this.onChange(e));
      host.addEventListener("input", (e) => { if (e.target.matches(".c3a-search")) { this.q = e.target.value; this.drawPicker(); } });
      this._hook = Hooks.on("updateToken", (doc) => { if (doc.id === this.tokenDoc.id && !this.picking) this.draw(); });
    }
    this.draw();
  }
  _onClose(o) { super._onClose?.(o); if (this._hook) Hooks.off("updateToken", this._hook); }

  // ─────────────────────────────────────────── drawing
  draw() {
    const host = this.element?.querySelector(".c3a-host");
    if (!host) return;
    const t = this.tokenDoc;
    const path = t.getFlag(L3D, "model3d");
    const m = modelFor(path);
    const roles = rolesFor(t);
    const actor = t.actor;
    const current = t.getFlag(L3D, "animIndex") ?? 0;
    const gm = game.user.isGM;

    const modelBox = `<section class="c3a-model">
      ${m?.preview ? `<img src="${esc(m.preview)}" alt="">` : `<div class="c3a-noimg"><i class="fa-solid fa-cube"></i></div>`}
      <div class="c3a-mi">
        <b>${esc(m?.name ?? (path ? decodeURIComponent(path.split("/").pop()) : "No 3D model"))}</b>
        <small>${m ? esc(m.source) : path ? "Not in the animated library — clips read from the model" : "This token has no 3D model yet"}</small>
        ${path && !t.getFlag(L3D, "enableAnim") ? `<small class="warn">Animation is switched off on this token.</small>` : ""}
      </div>
      <button type="button" data-do="pick"><i class="fa-solid fa-shuffle"></i> ${path ? "Change model" : "Choose a model"}</button>
    </section>`;

    const roleOf = (i) => Object.entries(ROLE).find(([k]) => roles?.[k] === i)?.[1] ?? (roles?.actions.includes(i) ? "Action" : roles?.extras?.includes(i) ? "Extra" : roles?.moves.includes(i) ? "Move" : "");
    const clips = roles ? `<section><h3>Clips <small>▶ plays it for everyone at the table</small></h3>
      <table class="c3a-clips"><tbody>${roles.list.map((c) => `<tr class="${c.i === current ? "on" : ""}">
        <td class="n">${c.i}</td><td>${esc(c.name)}</td><td><span class="c3a-role r-${roleOf(c.i).toLowerCase()}">${roleOf(c.i)}</span></td>
        <td class="n">${c.dur.toFixed(1)}s</td>
        <td class="btns"><button type="button" data-play="${c.i}" data-tooltip="Play once"><i class="fa-solid fa-play"></i></button>
          <button type="button" data-rest="${c.i}" data-tooltip="Make this the resting pose (loops)" ${c.i === current ? "disabled" : ""}><i class="fa-solid fa-thumbtack"></i></button></td></tr>`).join("")}
      </tbody></table></section>` : `<section class="c3a-empty">${path ? "Load the scene in 3D Canvas once so the clips can be read, or pick a model from the library." : ""}</section>`;

    let acts = "";
    if ((roles?.actions.length || roles?.extras?.length) && actor) {
      const items = actor.items.filter((i) => i.system.activities?.size && ["weapon", "feat", "spell", "consumable", "equipment"].includes(i.type))
        .sort((a, b) => (a.type === "weapon" ? -1 : 0) - (b.type === "weapon" ? -1 : 0) || a.name.localeCompare(b.name));
      const opts = (item) => {
        const saved = item.getFlag(MODULE_ID, "clip");
        const auto = autoPreview(t, item);
        return `<option value="" ${!saved ? "selected" : ""}>Automatic${auto !== null ? ` (${esc(roles.list[auto]?.name)})` : ""}</option>
          <option value="none" ${saved === "none" ? "selected" : ""}>No animation</option>
          ${[...roles.actions, ...(roles.extras ?? [])].map((i) => `<option value="${esc(roles.list[i].key)}" ${saved === roles.list[i].key ? "selected" : ""}>${esc(roles.list[i].name)}</option>`).join("")}`;
      };
      acts = `<section><h3>Actions <small>which clip plays when it's used — saved for every copy of ${esc(actor.name)}</small></h3>
        <table class="c3a-acts"><tbody>${items.map((it) => `<tr><td><img src="${esc(it.img)}" alt=""> ${esc(it.name)}</td>
          <td><select data-item="${it.id}" ${gm || actor.isOwner ? "" : "disabled"}>${opts(it)}</select></td>
          <td class="btns"><button type="button" data-test="${it.id}" data-tooltip="Test"><i class="fa-solid fa-play"></i></button></td></tr>`).join("") || `<tr><td>No usable items.</td></tr>`}</tbody></table>
        <p class="hint">Hurt, death and dead poses play by themselves from hit points.${roles.death === null ? " <b>This model has no death clip</b>, so the normal Dead marker is kept." : ""}</p></section>`;
    }

    const tools = gm ? `<section class="c3a-tools"><h3>Whole table</h3>
      <button type="button" data-do="scene"><i class="fa-solid fa-map"></i> Set up every creature on this scene</button>
      <button type="button" data-do="world"><i class="fa-solid fa-users"></i> Set up every NPC in this world</button>
      <button type="button" data-do="scan"><i class="fa-solid fa-folder-tree"></i> Scan extra model folders</button>
      <p class="hint c3a-status">${LIB.models.length} animated models in the library.</p></section>` : "";

    host.innerHTML = `<div class="c3a">${modelBox}<div class="c3a-picker"></div>${clips}${acts}${tools}</div>`;
    if (this.picking) this.drawPicker();
  }

  drawPicker() {
    const box = this.element?.querySelector(".c3a-picker");
    if (!box) return;
    if (!this.picking) { box.innerHTML = ""; return; }
    const t = this.tokenDoc;
    const q = this.q.trim();
    let list;
    if (q) {
      const ql = q.toLowerCase();
      list = LIB.models.filter((m) => m.name.toLowerCase().includes(ql) || m.aliases?.some((a) => a.toLowerCase().includes(ql))).slice(0, 60);
    } else {
      list = matchName(t.actor?.name ?? t.name, { min: 30, limit: 24 }).map((r) => r.model);
    }
    const cur = t.getFlag(L3D, "model3d");
    box.innerHTML = `<div class="c3a-pickhead"><input type="search" class="c3a-search" placeholder="Search ${LIB.models.length} animated models…" value="${esc(q)}">
        <label><input type="checkbox" class="c3a-proto" checked> Also for new ${esc(t.actor?.name ?? "copies")}</label>
        <button type="button" data-do="unpick" data-tooltip="Close"><i class="fa-solid fa-xmark"></i></button></div>
      <p class="hint">${q ? `${list.length} found` : `Best matches for “${esc(t.actor?.name ?? t.name)}” — type to search everything`}</p>
      <div class="c3a-grid">${list.map((m) => `<a class="c3a-card ${samePath(m.path, cur) ? "on" : ""}" data-model="${esc(m.path)}" data-tooltip="${esc(m.roles.list.map((c) => c.name).join(" · "))}">
        ${m.preview ? `<img src="${esc(m.preview)}" loading="lazy" alt="">` : `<div class="c3a-noimg"><i class="fa-solid fa-cube"></i></div>`}
        <span>${esc(m.name)}</span><em>${m.roles.death !== null ? "death · " : ""}${m.roles.actions.length} action${m.roles.actions.length === 1 ? "" : "s"}</em></a>`).join("") || `<p class="hint">Nothing matches.</p>`}</div>`;
    const input = box.querySelector(".c3a-search");
    if (q) { input.focus(); input.setSelectionRange(q.length, q.length); }
  }

  // ─────────────────────────────────────────── actions
  async onClick(e) {
    const t = this.tokenDoc;
    const card = e.target.closest("[data-model]");
    if (card) {
      const m = modelFor(card.dataset.model);
      if (!m) return;
      const proto = this.element.querySelector(".c3a-proto")?.checked && game.user.isGM;
      this.picking = false;
      await applyModel(t, m, { prototype: proto });
      ui.notifications.info(`${t.name} now uses ${m.name}.`);
      return this.draw();
    }
    const play = e.target.closest("[data-play]");
    if (play) { const i = Number(play.dataset.play); return playEverywhere(t, i, (rolesFor(t)?.list[i]?.dur ?? 1.5) * 1000); }
    const rest = e.target.closest("[data-rest]");
    if (rest) return t.setFlag(L3D, "animIndex", Number(rest.dataset.rest));
    const test = e.target.closest("[data-test]");
    if (test) {
      const item = t.actor?.items.get(test.dataset.test);
      const i = item ? clipForItem(t, item, item.system.activities?.contents?.[0]) : null;
      if (i === null || i === undefined) return ui.notifications.info("No animation for that one.");
      return playEverywhere(t, i, (rolesFor(t)?.list[i]?.dur ?? 1.5) * 1000);
    }
    const b = e.target.closest("[data-do]");
    if (!b) return;
    const status = this.element.querySelector(".c3a-status");
    switch (b.dataset.do) {
      case "pick": this.picking = true; this.q = ""; return this.drawPicker();
      case "unpick": this.picking = false; return this.drawPicker();
      case "scene": { const n = await setupScene(); ui.notifications.info(n ? `Set up ${n} token${n === 1 ? "" : "s"} on this scene.` : "Every creature here already has a model, or none matched."); return; }
      case "world": {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Set up every NPC" }, content: "<p>Give every NPC actor in this world whose token has no 3D model (or only a static 3D Canvas mini) the best-matching animated model?</p><p>Actors that already use a model you picked are left alone.</p>" });
        if (!ok) return;
        const n = await setupWorldActors((d, total) => { if (status) status.textContent = `Updating actors: ${d} of ${total}`; });
        ui.notifications.info(`Set up ${n} actor${n === 1 ? "" : "s"}.`);
        return this.draw();
      }
      case "scan": {
        const roots = game.settings.get(MODULE_ID, "extraFolders").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
        if (!roots.length) return ui.notifications.warn("Add folders in the module settings first (Configure Settings → 3D Creature Animator → Extra model folders).");
        b.disabled = true;
        try {
          const r = await scanFolders(roots, (msg) => { if (status) status.textContent = msg; });
          ui.notifications.info(`Scanned ${r.files} models — ${r.animated} have animations and are in the library now.`);
        } catch (err) { ui.notifications.error(`Scan failed: ${err.message}`); }
        return this.draw();
      }
    }
  }

  async onChange(e) {
    const sel = e.target.closest("select[data-item]");
    if (!sel) return;
    const actor = this.tokenDoc.actor;
    const item = actor?.items.get(sel.dataset.item);
    if (!item) return;
    const v = sel.value || null;
    // save on the world actor's item so every copy (unlinked tokens too) uses it
    const base = game.actors.get(this.tokenDoc.actorId);
    const targets = [item, base?.items.get(item.id)].filter((x, i, a) => x && a.indexOf(x) === i);
    for (const it of targets) { if (v) await it.setFlag(MODULE_ID, "clip", v); else await it.unsetFlag(MODULE_ID, "clip"); }
    this.draw();
  }
}

/** Which clip "Automatic" would pick, without advancing the rotation. */
function autoPreview(tokenDoc, item) {
  try { return clipForItem(tokenDoc, item, item.system.activities?.contents?.[0], { rotate: false, ignoreSaved: true }) ?? null; }
  catch { return null; }
}
