import { h, ic, chip, progressBar } from "../ui.js";
import { t, LANG, nf } from "../i18n.js";

const STEP_ICON = { receive: "inbox", identify: "proj", understand: "search", entities: "layers", tool: "db", rule: "shield", route: "flow", reply: "send", warn: "warn", scope: "proj", data: "db", formula: "dash", query: "db", rank: "flow", answer: "check", parse: "rep", match: "search", price: "card", result: "check" };
const STEP_CLS = { tool: "blue", rule: "sky", route: "violet", reply: "green", warn: "amber", formula: "sky", answer: "green", result: "green", price: "blue" };
export function trace(steps, { animate = false } = {}) {
  if (!steps?.length) return h("div", { class: "empty small" }, t("No steps"));
  return h("ol", { class: "trace" }, ...steps.map((s, i) => h("li", { class: `${STEP_CLS[s.k] || ""}${animate ? " in" : ""}`, style: animate ? { animationDelay: `${i * 100}ms` } : null },
    h("span", { class: "ti" }, ic(STEP_ICON[s.k] || "check")), h("div", {}, h("div", { class: "tl", dir: "auto" }, s.k === "tool" ? h("code", {}, s.label) : s.label), s.detail ? h("div", { class: "td", dir: "auto" }, s.detail) : null))));
}
export const healthChip = hl => chip(t({ red: "Critical", amber: "Watch", green: "Healthy" }[hl]), { red: "red", amber: "amber", green: "green" }[hl]);
export const KIND = { progress: ["Progress", "green"], material_request: ["Material request", "blue"], rfi: ["RFI", "violet"], safety: ["Safety", "red"], delay: ["Delay", "amber"], manpower: ["Manpower", "sky"], other: ["Other", "grey"] };
export const kindChip = k => chip(t(KIND[k]?.[0] || k), KIND[k]?.[1] || "grey");
export const ST = { applied: "green", needs_review: "amber", ignored: "grey", new: "blue", rfq_sent: "sky", quoted: "violet", pending_approval: "amber", approved: "green", po_issued: "blue", delivered: "green", cancelled: "grey", issued: "blue", paid: "green", open: "red", answered: "green", closed: "grey", draft: "grey", submitted: "blue", won: "green", lost: "grey", pending: "amber", rejected: "red", active: "green", handover: "violet", on_hold: "amber" };
export const stChip = s => chip(t(s), ST[s] || "grey");
export const pname = p => (LANG === "ar" ? p.name_ar || p.project_ar : p.name_en || p.project_en);
export const sar = n => `${nf(n)} ${t("SAR")}`;
export const ksar = n => (Math.abs(n) >= 1e6 ? `${nf(n / 1e6, 2)}${LANG === "ar" ? " م" : "M"}` : `${nf(n / 1e3, 0)}${LANG === "ar" ? " ألف" : "k"}`);
export function dualBar(done, planned) {
  return h("div", { class: "dual", title: `${done}% / ${planned}%` }, h("i", { class: "pl", style: { width: `${Math.min(100, planned)}%` } }), h("i", { class: "dn" + (done + 10 < planned ? " late" : ""), style: { width: `${Math.min(100, done)}%` } }));
}
export function idx(v, good = 1) { return h("b", { class: v >= 0.97 * good ? "ok" : v >= 0.9 ? "warn-a" : "warn-t" }, nf(v, 2)); }
