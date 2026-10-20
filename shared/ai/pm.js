// AI Project Manager: answers management questions in Arabic or English from live project data.
// Each answer = a short narrative + a table (+ a chart) + the trace of how it was computed
// (which intent, which projects, which formulas) — so the number can always be checked.
import { normalize, has, detectLang, esc } from "./nlu.js";
import { projectStats, health, isoDay } from "../metrics.js";

export const PM_INTENTS = [
  ["delayed", ["متاخر", "متأخر", "متاخره", "المتاخره", "متأخرة", "تاخير", "التاخير", "ورا الجدول", "خلف الجدول", "late", "delayed", "behind", "behind schedule", "slipping", "delay"]],
  ["over_budget", ["تجاوز", "متجاوز", "فوق الميزانيه", "الميزانيه", "خساره", "خسران", "بنخسر", "over budget", "overrun", "cost overrun", "losing money", "budget", "cpi", "margin"]],
  ["spend", ["صرفنا", "المصروف", "التكلفه", "التكاليف", "كم كلف", "spent", "spend", "cost so far", "costs", "how much did we spend", "actual cost"]],
  ["rfis", ["استفسار", "استفسارات", "rfi", "rfis", "الاستشاري", "consultant"]],
  ["materials", ["مواد", "المواد", "طلبات الشراء", "اوامر الشراء", "توريد", "التوريدات", "material", "materials", "po", "pos", "purchase order", "purchase orders", "deliveries", "procurement"]],
  ["cash", ["تدفق", "كاش", "سيوله", "مستحقات", "المستخلصات", "مستخلص", "فواتير", "تحصيل", "cash", "cash flow", "receivable", "receivables", "invoices", "collections", "billing", "billed"]],
  ["manpower", ["عماله", "العماله", "كم عامل", "عمال", "manpower", "workers", "headcount", "labour", "labor"]],
  ["safety", ["سلامه", "السلامه", "حوادث", "حادث", "اصابات", "safety", "incident", "incidents", "accidents", "hse"]],
  ["priorities", ["اولويات", "الاولويات", "اركز", "ايش اسوي", "وش اسوي", "اعمل ايه", "اهم", "priorities", "focus", "what should i", "this week", "today", "urgent", "risks", "مخاطر"]],
  ["summary", ["وضع", "حاله", "ملخص", "تقرير", "اخبار", "status", "summary", "update on", "how is", "report", "overview"]],
];

export function answer(dbx, { tenant_id, question, now = new Date() }) {
  const q = normalize(question); const lang = detectLang(question); const L = (ar, en) => (lang === "ar" ? ar : en);
  const trace = []; const step = (k, label, detail = "") => trace.push({ k, label, detail: String(detail) });
  const projects = dbx.all("SELECT * FROM projects WHERE tenant_id=? AND status IN ('active','on_hold','handover') ORDER BY code", [tenant_id]);
  const pname = p => (lang === "ar" ? p.name_ar : p.name_en);
  // which project(s)?
  const named = projects.filter(p => new RegExp(`(^|[^\\w])${esc(p.code.toLowerCase())}($|[^\\w])`).test(q) || String(p.aliases || "").split(",").map(normalize).filter(Boolean).some(a => q.includes(a)));
  // specific nouns (RFIs, materials, invoices…) outrank generic adjectives (late, over budget)
  const WEIGHT = { delayed: 1, over_budget: 1, summary: 0.7, priorities: 1.6, spend: 1.8, rfis: 2, materials: 2, cash: 2.2, manpower: 1.8, safety: 2 };
  const scored = PM_INTENTS.map(([k, ws]) => [k, [...new Set(ws.map(normalize))].filter(w => has(q, [w])).length * WEIGHT[k]]).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
  let intent = scored[0]?.[0] || (named.length ? "summary" : "unknown");
  if (named.length === 1 && ["delayed", "over_budget"].includes(intent) && !has(q, ["مشاريع", "المشاريع", "projects", "which"])) intent = "summary";
  step("understand", L("فهم السؤال", "Understood the question"), `${intent}${scored.length > 1 ? ` · ${L("بدائل", "alternatives")}: ${scored.slice(1, 3).map(s => s[0]).join(", ")}` : ""}`);
  const scope = named.length ? named : projects;
  step("scope", L("النطاق", "Scope"), named.length ? named.map(p => p.code).join(", ") : L(`كل المشاريع النشطة (${projects.length})`, `all active projects (${projects.length})`));
  const S = Object.fromEntries(scope.map(p => [p.id, projectStats(dbx, p, now)]));
  step("data", L("البيانات", "Data read"), L("الأنشطة، سجلات الإنجاز، التكاليف، الاستفسارات، الطلبات، الفواتير — حتى ", "activities, progress entries, costs, RFIs, requests, invoices — as of ") + isoDay(now));
  const money = n => `${Math.round(n).toLocaleString("en-US")} ${L("ر.س", "SAR")}`;
  let text = "", table = null, chart = null;

  switch (intent) {
    case "delayed": {
      const rows = scope.map(p => ({ p, s: S[p.id] })).filter(x => x.s.spi < 0.95).sort((a, b) => a.s.spi - b.s.spi);
      step("formula", "SPI = EV / PV", L("المشروع متأخر إذا SPI < 0.95", "a project is behind when SPI < 0.95"));
      text = rows.length ? L(`${rows.length} مشروع متأخر عن الجدول. الأسوأ ${pname(rows[0].p)} (${rows[0].p.code}): منجز ${rows[0].s.progress}% مقابل مخطط ${rows[0].s.planned}%، والتأخير المتوقع حوالي ${rows[0].s.forecast_delay_days} يوم.`, `${rows.length} project(s) are behind schedule. Worst: ${pname(rows[0].p)} (${rows[0].p.code}) — ${rows[0].s.progress}% done vs ${rows[0].s.planned}% planned, about ${rows[0].s.forecast_delay_days} days forecast delay.`)
        : L("كل المشاريع ماشية حسب الجدول أو أفضل 👍", "All projects are on or ahead of schedule 👍");
      for (const x of rows.slice(0, 3)) { const why = whyLate(dbx, x.p, x.s, L); if (why) text += `\n• ${x.p.code}: ${why}`; }
      table = { cols: [L("المشروع", "Project"), L("منجز", "Done"), L("مخطط", "Planned"), "SPI", L("تأخير متوقع", "Forecast delay"), L("تأخيرات مفتوحة", "Open delays")], rows: rows.map(x => [`${x.p.code} · ${pname(x.p)}`, `${x.s.progress}%`, `${x.s.planned}%`, x.s.spi, `${x.s.forecast_delay_days} ${L("يوم", "d")}`, x.s.open_delays]) };
      chart = { type: "bars", items: scope.map(p => ({ l: p.code, v: Math.round(S[p.id].spi * 100), color: S[p.id].spi < 0.95 ? "var(--red)" : "var(--mint)" })), label: "SPI × 100" };
      break;
    }
    case "over_budget": {
      const rows = scope.map(p => ({ p, s: S[p.id] })).filter(x => x.s.cpi < 0.97 && x.s.ac > 0).sort((a, b) => a.s.cpi - b.s.cpi);
      step("formula", "CPI = EV / AC · EAC = BAC / CPI", L("تجاوز إذا CPI < 0.97", "over budget when CPI < 0.97"));
      text = rows.length ? L(`${rows.length} مشروع يصرف أكثر من قيمة المنجز. ${pname(rows[0].p)}: كل 1 ريال صرف يقابله ${rows[0].s.cpi} ريال إنجاز، والتكلفة المتوقعة عند الانتهاء ${money(rows[0].s.eac)} مقابل ميزانية ${money(rows[0].s.bac)}.`, `${rows.length} project(s) are spending more than they earn. ${pname(rows[0].p)}: every 1 SAR spent earns ${rows[0].s.cpi} SAR of work; forecast cost at completion ${money(rows[0].s.eac)} vs budget ${money(rows[0].s.bac)}.`)
        : L("لا يوجد مشروع متجاوز للميزانية حاليًا.", "No project is over budget right now.");
      table = { cols: [L("المشروع", "Project"), "CPI", L("الميزانية", "Budget"), L("المتوقع عند الانتهاء", "Forecast at completion"), L("الربح المتوقع", "Forecast margin")], rows: rows.map(x => [`${x.p.code} · ${pname(x.p)}`, x.s.cpi, money(x.s.bac), money(x.s.eac), money(x.s.margin_forecast)]) };
      chart = { type: "bars", items: scope.map(p => ({ l: p.code, v: Math.round(S[p.id].cpi * 100), color: S[p.id].cpi < 0.97 ? "var(--red)" : "var(--mint)" })), label: "CPI × 100" };
      break;
    }
    case "spend": {
      const rows = dbx.all(`SELECT p.code, category, SUM(amount) s FROM costs c JOIN projects p ON p.id=c.project_id WHERE p.id IN (${scope.map(() => "?").join(",")}) GROUP BY p.code, category ORDER BY p.code`, scope.map(p => p.id));
      const tot = rows.reduce((a, r) => a + r.s, 0);
      step("query", L("تجميع التكاليف", "Summed costs"), L("حسب المشروع والفئة", "by project and category"));
      text = L(`إجمالي المصروف ${named.length === 1 ? "على " + pname(named[0]) : "على المشاريع"}: ${money(tot)}.`, `Total spent ${named.length === 1 ? "on " + pname(named[0]) : "across projects"}: ${money(tot)}.`);
      const cats = ["material", "labor", "subcontract", "equipment", "overhead"];
      table = { cols: [L("المشروع", "Project"), ...cats.map(c => L({ material: "مواد", labor: "عمالة", subcontract: "مقاولي باطن", equipment: "معدات", overhead: "مصاريف عامة" }[c], c)), L("الإجمالي", "Total")],
        rows: scope.map(p => { const r = cats.map(c => rows.find(x => x.code === p.code && x.category === c)?.s || 0); return [p.code, ...r.map(money), money(r.reduce((a, b) => a + b, 0))]; }) };
      chart = { type: "bars", items: cats.map((c, i) => ({ l: c.slice(0, 8), v: Math.round(rows.filter(r => r.category === c).reduce((a, r) => a + r.s, 0) / 1000), color: `var(--chart-${(i % 4) + 1})` })), label: L("بالألف ريال", "SAR thousands") };
      break;
    }
    case "rfis": {
      const rows = dbx.all(`SELECT r.*, p.code FROM rfis r JOIN projects p ON p.id=r.project_id WHERE p.id IN (${scope.map(() => "?").join(",")}) AND r.status='open' ORDER BY r.due_at`, scope.map(p => p.id));
      const overdue = rows.filter(r => r.due_at < isoDay(now));
      text = L(`${rows.length} استفسار مفتوح، منها ${overdue.length} متأخر الرد من الاستشاري.${overdue[0] ? ` أقدمها ${overdue[0].no} (${overdue[0].subject}).` : ""}`, `${rows.length} open RFIs, ${overdue.length} overdue from the consultant.${overdue[0] ? ` Oldest: ${overdue[0].no} (${overdue[0].subject}).` : ""}`);
      table = { cols: ["RFI", L("المشروع", "Project"), L("الموضوع", "Subject"), L("التخصص", "Discipline"), L("موعد الرد", "Due"), L("الحالة", "Status")], rows: rows.map(r => [r.no, r.code, r.subject, r.discipline || "", r.due_at, r.due_at < isoDay(now) ? L("متأخر", "overdue") : L("مفتوح", "open")]) };
      break;
    }
    case "materials": {
      const pos = dbx.all(`SELECT po.*, s.name supplier, p.code FROM purchase_orders po JOIN material_requests m ON m.id=po.mr_id JOIN projects p ON p.id=m.project_id JOIN suppliers s ON s.id=po.supplier_id WHERE p.id IN (${scope.map(() => "?").join(",")}) AND po.status='issued' ORDER BY po.expected_at`, scope.map(p => p.id));
      const mrs = dbx.all(`SELECT m.*, p.code FROM material_requests m JOIN projects p ON p.id=m.project_id WHERE p.id IN (${scope.map(() => "?").join(",")}) AND m.status IN ('new','rfq_sent','quoted','pending_approval','approved') ORDER BY m.needed_by`, scope.map(p => p.id));
      const late = pos.filter(x => x.expected_at < isoDay(now));
      text = L(`${pos.length} أمر شراء بانتظار التوريد (${late.length} متأخر)، و${mrs.length} طلب مواد لم يصدر له أمر شراء بعد.`, `${pos.length} POs awaiting delivery (${late.length} late), and ${mrs.length} material requests without a PO yet.`);
      table = { cols: [L("المرجع", "Ref"), L("المشروع", "Project"), L("المورد / الحالة", "Supplier / status"), L("القيمة", "Value"), L("متوقع / مطلوب", "Expected / needed")], rows: [...pos.map(x => [x.no, x.code, x.supplier, money(x.total), x.expected_at + (x.expected_at < isoDay(now) ? " ⚠" : "")]), ...mrs.map(m => [m.no, m.code, m.status, "—", m.needed_by])] };
      break;
    }
    case "cash": {
      const rows = dbx.all(`SELECT i.*, p.code FROM invoices i JOIN projects p ON p.id=i.project_id WHERE p.id IN (${scope.map(() => "?").join(",")}) AND i.status='issued' ORDER BY i.due_date`, scope.map(p => p.id));
      const od = rows.filter(r => r.due_date < isoDay(now)), next30 = rows.filter(r => r.due_date >= isoDay(now) && r.due_date <= isoDay(new Date(now.getTime() + 30 * 864e5)));
      const sum = a => a.reduce((x, r) => x + r.amount, 0);
      text = L(`مستحقات غير محصلة ${money(sum(rows))}: متأخر منها ${money(sum(od))}، ومتوقع تحصيل ${money(sum(next30))} خلال 30 يوم.`, `Unpaid client invoices ${money(sum(rows))}: ${money(sum(od))} overdue, ${money(sum(next30))} due in the next 30 days.`);
      table = { cols: [L("المستخلص", "Invoice"), L("المشروع", "Project"), L("المبلغ", "Amount"), L("الاستحقاق", "Due"), ""], rows: rows.map(r => [r.no, r.code, money(r.amount), r.due_date, r.due_date < isoDay(now) ? L("متأخر", "overdue") : ""]) };
      break;
    }
    case "manpower": {
      const rows = scope.map(p => [p.code, pname(p), S[p.id].manpower_today]);
      text = L(`إجمالي العمالة في آخر تقرير: ${rows.reduce((a, r) => a + r[2], 0)} عامل وفني.`, `Total manpower in the latest reports: ${rows.reduce((a, r) => a + r[2], 0)}.`);
      table = { cols: [L("الكود", "Code"), L("المشروع", "Project"), L("العمالة", "Manpower")], rows };
      chart = { type: "bars", items: rows.map(r => ({ l: r[0], v: r[2] })), label: L("عمالة", "headcount") };
      break;
    }
    case "safety": {
      const rows = dbx.all(`SELECT i.*, p.code FROM incidents i JOIN projects p ON p.id=i.project_id WHERE p.id IN (${scope.map(() => "?").join(",")}) AND i.kind='safety' ORDER BY i.at DESC LIMIT 20`, scope.map(p => p.id));
      text = L(`${rows.length} بلاغ سلامة مسجل، ${rows.filter(r => r.status === "open").length} منها مفتوح.`, `${rows.length} safety reports, ${rows.filter(r => r.status === "open").length} still open.`);
      table = { cols: [L("التاريخ", "Date"), L("المشروع", "Project"), L("الخطورة", "Severity"), L("الوصف", "Description"), L("الحالة", "Status")], rows: rows.map(r => [r.at.slice(0, 10), r.code, r.severity, r.description.slice(0, 90), r.status]) };
      break;
    }
    case "priorities": {
      const items = [];
      for (const p of scope) { const s = S[p.id];
        if (s.spi < 0.9) items.push([3, p.code, L(`متأخر (SPI ${s.spi}) — راجع ${whyLate(dbx, p, s, L) || "أسباب التأخير"}`, `behind (SPI ${s.spi}) — ${whyLate(dbx, p, s, L) || "review delay causes"}`)]);
        if (s.cpi < 0.95) items.push([3, p.code, L(`تكلفة أعلى من الإنجاز (CPI ${s.cpi})`, `cost running ahead of work (CPI ${s.cpi})`)]);
        if (s.overdue_rfis) items.push([2, p.code, L(`${s.overdue_rfis} استفسار متأخر الرد — صعّد للاستشاري`, `${s.overdue_rfis} RFI(s) overdue — escalate to the consultant`)]);
        if (s.late_pos) items.push([2, p.code, L(`${s.late_pos} أمر شراء متأخر التوريد`, `${s.late_pos} PO(s) late`)]);
        if (s.overdue_receivables) items.push([2, p.code, L(`مستخلصات متأخرة ${money(s.overdue_receivables)}`, `overdue client invoices ${money(s.overdue_receivables)}`)]);
        if (s.open_safety) items.push([3, p.code, L(`${s.open_safety} بلاغ سلامة مفتوح`, `${s.open_safety} open safety report(s)`)]); }
      const pend = dbx.get("SELECT COUNT(*) n FROM approvals WHERE tenant_id=? AND status='pending'", [tenant_id]).n;
      if (pend) items.push([2, "—", L(`${pend} موافقة بانتظارك`, `${pend} approval(s) waiting for you`)]);
      items.sort((a, b) => b[0] - a[0]);
      step("rank", L("ترتيب حسب الأثر", "Ranked by impact"), L("سلامة وجدول وتكلفة أولًا، ثم الاستشاري والتوريد والتحصيل", "safety, schedule and cost first; then consultant, supply and cash"));
      text = items.length ? L(`أهم ${Math.min(5, items.length)} أولويات الآن:`, `Top ${Math.min(5, items.length)} priorities right now:`) + "\n" + items.slice(0, 5).map((x, i) => `${i + 1}. ${x[1]} — ${x[2]}`).join("\n") : L("لا توجد مخاطر عالية حاليًا 👍", "No high risks right now 👍");
      table = { cols: [L("الأولوية", "Priority"), L("المشروع", "Project"), L("البند", "Item")], rows: items.map(x => [x[0] === 3 ? L("عالية", "high") : L("متوسطة", "medium"), x[1], x[2]]) };
      break;
    }
    case "summary": {
      const rows = scope.map(p => ({ p, s: S[p.id] }));
      if (rows.length === 1) { const { p, s } = rows[0];
        text = L(`${pname(p)} (${p.code}): منجز ${s.progress}% مقابل مخطط ${s.planned}% (SPI ${s.spi})، الصرف ${money(s.ac)} مقابل قيمة منجزة ${money(s.ev)} (CPI ${s.cpi}). ${s.open_rfis} استفسار مفتوح، ${s.pending_mrs} طلب مواد قيد التنفيذ، ${s.open_delays} تأخير مسجل. العمالة في آخر تقرير ${s.manpower_today}.`,
          `${pname(p)} (${p.code}): ${s.progress}% done vs ${s.planned}% planned (SPI ${s.spi}); spent ${money(s.ac)} for ${money(s.ev)} earned (CPI ${s.cpi}). ${s.open_rfis} open RFIs, ${s.pending_mrs} material requests in progress, ${s.open_delays} open delays. Latest manpower: ${s.manpower_today}.`);
        const why = whyLate(dbx, p, s, L); if (s.spi < 0.95 && why) text += L(`\nسبب التأخير الأرجح: ${why}`, `\nMost likely cause of delay: ${why}`);
        table = { cols: [L("النشاط", "Activity"), L("المنفذ", "Done"), L("المخطط حتى اليوم", "Planned to date"), L("الحالة", "Status")], rows: s.activities.map(a => [`${a.code} · ${lang === "ar" ? a.name_ar : a.name_en}`, `${Math.round(a.pct * 100)}% (${Math.round(a.done)}/${a.qty} ${a.unit})`, `${Math.round(a.planned_pct * 100)}%`, a.behind ? L("متأخر", "behind") : L("حسب الخطة", "on track")]) };
        chart = { type: "bars", items: s.activities.map(a => ({ l: a.code, v: Math.round(a.pct * 100), color: a.behind ? "var(--red)" : "var(--mint)" })), label: L("% منجز", "% done") };
      } else {
        text = L(`${rows.length} مشاريع نشطة: ${rows.filter(x => health(x.s) === "red").length} حرجة، ${rows.filter(x => health(x.s) === "amber").length} تحتاج متابعة، ${rows.filter(x => health(x.s) === "green").length} سليمة.`, `${rows.length} active projects: ${rows.filter(x => health(x.s) === "red").length} critical, ${rows.filter(x => health(x.s) === "amber").length} need attention, ${rows.filter(x => health(x.s) === "green").length} healthy.`);
        table = { cols: [L("المشروع", "Project"), L("منجز / مخطط", "Done / planned"), "SPI", "CPI", "RFIs", L("الحالة", "Health")], rows: rows.map(x => [`${x.p.code} · ${pname(x.p)}`, `${x.s.progress}% / ${x.s.planned}%`, x.s.spi, x.s.cpi, x.s.open_rfis, health(x.s)]) };
      }
      break;
    }
    default:
      text = L("أقدر أجاوب عن: المشاريع المتأخرة، المتجاوزة للميزانية، المصروف، الاستفسارات المفتوحة، المواد وأوامر الشراء، المستخلصات والتدفق النقدي، العمالة، السلامة، أولويات الأسبوع، أو ملخص أي مشروع بالاسم أو الكود.", "I can answer: which projects are late or over budget, spend, open RFIs, materials and POs, invoices and cash flow, manpower, safety, this week's priorities, or a summary of any project by name or code.");
  }
  step("answer", L("الإجابة", "Answer"), `${table ? table.rows.length + " " + L("صف", "rows") : ""}${chart ? " · " + L("رسم", "chart") : ""}`);
  return { intent, lang, text, table, chart, trace, projects: scope.map(p => p.code) };
}

const CAUSE_AR = { material: "تأخر توريد المواد", "consultant approval": "انتظار اعتماد الاستشاري", client: "العميل", "site access": "الدخول للموقع", "other trades": "أعمال مقاولين آخرين", weather: "الطقس", unspecified: "غير محدد" };
function whyLate(dbx, p, s, L) {
  const d = dbx.get("SELECT cause, description FROM incidents WHERE project_id=? AND kind='delay' AND status='open' ORDER BY at DESC", [p.id]);
  const behind = s.activities.filter(a => a.behind).sort((a, b) => (b.planned_pct - b.pct) * b.budget_cost - (a.planned_pct - a.pct) * a.budget_cost)[0];
  const parts = [];
  if (behind) parts.push(L(`أكبر فجوة في «${behind.name_ar}» (${Math.round(behind.pct * 100)}% مقابل ${Math.round(behind.planned_pct * 100)}%)`, `biggest gap in "${behind.name_en}" (${Math.round(behind.pct * 100)}% vs ${Math.round(behind.planned_pct * 100)}%)`));
  if (d) parts.push(L(`تأخير مسجل بسبب ${CAUSE_AR[d.cause] || d.cause}`, `open delay: ${d.cause}`));
  if (s.overdue_rfis) parts.push(L(`${s.overdue_rfis} استفسار متأخر`, `${s.overdue_rfis} overdue RFI(s)`));
  if (s.late_pos) parts.push(L(`${s.late_pos} أمر شراء متأخر`, `${s.late_pos} late PO(s)`));
  return parts.join("، ");
}
