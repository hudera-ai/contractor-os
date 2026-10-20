// App shell + hash router. Views in src/views/*.js
import { createApi } from "./api.js";
import { t, LANG, setLang } from "./i18n.js";
import { h, $, ic, toast } from "./ui.js";
import * as views from "./views/index.js";

export const app = { api: null, session: null, route: { name: "dashboard" } };
export const rpc = (op, args) => app.api.rpc(op, args);
const NAV = [["dashboard", "Overview", "dash", 1], ["projects", "Projects", "proj", 1], ["field", "Field inbox", "inbox", 1], ["ask", "Ask the AI PM", "bot", 1], ["procurement", "Procurement", "card", 0], ["estimation", "Estimation", "rep", 0], ["approvals", "Approvals", "shield", 1], ["settings", "Settings", "cog", 0]];
const ALIAS = { project: "projects", mr: "procurement", estimate: "estimation" };
export const navigate = hash => { location.hash = hash; };
export function parseRoute() { const [path, qs] = location.hash.replace(/^#\/?/, "").split("?"); const [name = "dashboard", id = null] = path.split("/"); return { name: name || "dashboard", id, params: Object.fromEntries(new URLSearchParams(qs || "")) }; }
export function setTheme(v) { if (v === "system") { delete document.documentElement.dataset.theme; localStorage.removeItem("cos.theme"); } else { document.documentElement.dataset.theme = v; localStorage.setItem("cos.theme", v); } }
export async function refreshSession() { app.session = await rpc("session.info"); }
export async function updateBadges() {
  try { await refreshSession(); } catch { return; }
  const c = { approvals: app.session.counts.approvals, field: app.session.counts.field };
  for (const [n, v] of Object.entries(c)) document.querySelectorAll(`.nav a[href="#/${n}"], .mobile-nav a[href="#/${n}"]`).forEach(a => { a.querySelector(".cnt")?.remove(); if (v) a.append(h("span", { class: "cnt" }, v)); });
}

function shell() {
  const s = app.session, u = s.user, cur = ALIAS[app.route.name] || app.route.name;
  const counts = { approvals: s.counts.approvals, field: s.counts.field };
  const link = ([n, l, i]) => h("a", { href: `#/${n}`, class: cur === n ? "on" : "" }, ic(i), h("span", {}, t(l)), counts[n] ? h("span", { class: "cnt" }, counts[n]) : null);
  const initials = u.name.replace(/^Eng\. /, "").split(" ").filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();
  return h("div", { class: "shell" },
    h("aside", { class: "side" },
      h("div", { class: "brand" }, h("span", { class: "mark" }, "C"), h("span", {}, "Contractor OS", h("small", {}, "HUDERA · " + t("AI for contractors")))),
      h("div", { class: "tenant-box" }, h("div", { class: "xs faint" }, t("Company")), h("div", { class: "tn" }, LANG === "ar" ? s.tenant.name_ar : s.tenant.name_en), h("div", { class: "xs muted" }, `${s.tenant.trade} · ${s.tenant.city} · ${s.projects.length} ${t("projects")}`)),
      h("nav", { class: "nav col", style: { gap: "2px" } }, ...NAV.map(link)),
      h("div", { class: "user" }, h("span", { class: "avatar" }, initials), h("div", { style: { minWidth: 0 } }, h("div", { class: "small", style: { fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, u.name), h("div", { class: "xs muted" }, t(u.role))),
        h("span", { class: "sp" }), h("button", { class: "btn ghost sm", title: LANG === "ar" ? "English" : "العربية", onclick: () => { setLang(LANG === "ar" ? "en" : "ar"); render(); } }, LANG === "ar" ? "EN" : "ع"),
        h("button", { class: "btn ghost sm", title: t("Sign out"), onclick: async () => { await app.api.logout(); app.session = null; render(); } }, ic("out")))),
    h("main", { class: "main", id: "view" }),
    h("nav", { class: "mobile-nav" }, ...NAV.filter(n => n[3]).map(link)));
}

export async function render() {
  setLang(LANG); document.body.replaceChildren();
  if (!app.session) { document.body.append(views.login(app)); return; }
  app.route = parseRoute();
  document.body.append(shell());
  const view = $("#view"); view.replaceChildren(h("div", { class: "empty" }, h("span", { class: "spinner" })));
  const fn = views[app.route.name] || views[ALIAS[app.route.name]] || views.dashboard;
  try { view.replaceChildren(await fn(app, app.route)); }
  catch (e) { console.error(e); view.replaceChildren(h("div", { class: "card" }, h("div", { class: "bd" }, h("h2", {}, t("Something went wrong")), h("p", { class: "muted small mono" }, e.message)))); }
  window.scrollTo(0, 0);
}
export async function rerender() { await refreshSession(); await render(); }
window.addEventListener("hashchange", () => { if (app.session) render(); });
window.addEventListener("unhandledrejection", e => toast(e.reason?.message || String(e.reason), true));
(async () => {
  const th = localStorage.getItem("cos.theme"); if (th) document.documentElement.dataset.theme = th;
  setLang(LANG); app.api = await createApi();
  try { await refreshSession(); } catch { app.session = null; }
  render();
})();
