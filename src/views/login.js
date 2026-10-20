import { h, ic, toast } from "../ui.js";
import { t, LANG, setLang } from "../i18n.js";
import { refreshSession, render } from "../main.js";
const DEMO = [["owner@watad.example", "Saud Al-Harbi", "owner"], ["pm@watad.example", "Eng. Hani Fawzi", "pm"], ["procurement@watad.example", "Rana Al-Hamad", "procurement"], ["estimator@watad.example", "Eng. Omar Siddiqui", "estimator"], ["bilal@watad.example", "Eng. Bilal Ahmed", "site_engineer"], ["owner@lamsa.example", "Maha Al-Zahrani", "owner", "Lamsa Fit-Out"]];
export function login(app) {
  const email = h("input", { type: "email", value: "owner@watad.example" }), pass = h("input", { type: "password", value: "demo1234" });
  const go = async (e, p) => { try { await app.api.login(e || email.value, p || pass.value); await refreshSession(); location.hash = ""; render(); } catch { toast(t("Wrong email or password"), true); } };
  return h("div", { class: "login" }, h("div", { class: "card" }, h("div", { class: "bd col", style: { gap: "16px" } },
    h("div", { class: "row" }, h("div", { class: "brand", style: { padding: 0 } }, h("span", { class: "mark" }, "C"), h("span", {}, "Contractor OS", h("small", {}, "HUDERA · " + t("AI for contractors")))), h("span", { class: "sp" }),
      h("button", { class: "btn ghost sm", onclick: () => { setLang(LANG === "ar" ? "en" : "ar"); render(); } }, LANG === "ar" ? "English" : "العربية")),
    h("p", { class: "muted small" }, t("Site messages become records. An AI project manager answers from live data. Procurement and estimation agents do the legwork.")),
    h("div", { class: "banner blue" }, ic("shield"), t("Demo with fictional companies and sample data. Nothing here is a real client.")),
    h("form", { class: "col", onsubmit: e => { e.preventDefault(); go(); } }, h("label", { class: "f" }, h("span", {}, t("Email")), email), h("label", { class: "f" }, h("span", {}, t("Password")), pass), h("button", { class: "btn primary", type: "submit" }, t("Sign in"))),
    h("div", { class: "col", style: { gap: "6px" } }, h("div", { class: "xs muted" }, t("Or pick a demo user"), " · ", t("password"), " ", h("code", {}, "demo1234")),
      h("div", { class: "demo-users" }, ...DEMO.map(([e, n, r, c]) => h("button", { onclick: () => go(e, "demo1234") }, h("span", { class: "avatar" }, n.replace(/^Eng\. /, "").split(" ").map(x => x[0]).slice(0, 2).join("")),
        h("span", {}, h("b", { class: "small", style: { display: "block", color: "var(--ink)" } }, n), h("span", { class: "xs muted" }, `${t(r)} · ${c || "Watad MEP Contracting"}`)))))))));
}
