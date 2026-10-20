// Field agent: one WhatsApp message from site → what it is, which project, which records it should
// create, who must know, and the reply to the sender. Pure function of (text, context) + a trace.
import { normalize, has, count, quantities, findDates, extractDuration, detectLang, iso, esc } from "./nlu.js";

const CAUSE_AR = { material: "تأخر توريد المواد", "consultant approval": "انتظار اعتماد الاستشاري", client: "العميل", "site access": "الدخول للموقع", "other trades": "أعمال مقاولين آخرين", weather: "الطقس", unspecified: "غير محدد" };
export const KINDS = ["progress", "material_request", "rfi", "safety", "delay", "manpower", "other"];
const CUES = {
  material_request: [["نحتاج", "نحتاج", "محتاجين", "محتاج", "ابغى", "نبغى", "نبي", "اطلبوا", "اطلب", "ارسلوا", "ابعتوا", "توريد", "وفروا", "خلصت", "نقص", "ناقص", "need", "needs", "send", "order", "request", "supply", "deliver", "running out", "short of", "required on site"], 1.3],
  progress: [["خلصنا", "انجزنا", "انجاز", "تم تركيب", "ركبنا", "تركيب", "صبينا", "مدينا", "سحبنا", "تم سحب", "اختبار", "تم اختبار", "اشتغلنا", "خلص", "انتهينا", "installed", "completed", "done", "finished", "pulled", "laid", "tested", "progress", "today we", "achieved", "fixed"], 1.2],
  rfi: [["استفسار", "مش واضح", "غير واضح", "تعارض", "تضارب", "المخطط", "المخططات", "الرسومات", "الاستشاري", "نحتاج توضيح", "توضيح", "rfi", "clash", "conflict", "clarify", "clarification", "drawing", "drawings", "not clear", "unclear", "discrepancy", "which one", "consultant"], 1.3],
  safety: [["اصابه", "اصابة", "انصاب", "حادث", "حادثه", "سقط", "وقع", "حريق", "ماس", "صعقه", "اسعاف", "مستشفى", "سلامه", "injury", "injured", "accident", "fell", "fall", "fire", "near miss", "unsafe", "electric shock", "ambulance", "hospital", "first aid", "hse"], 1.6],
  delay: [["تاخير", "تأخير", "متاخر", "متاخرين", "متأخرين", "متوقف", "توقف", "وقفنا", "واقف", "ما وصل", "ما وصلت", "ماوصلت", "لم تصل", "ماوصل", "لم يصل", "بانتظار", "ننتظر", "مستني", "مستنيين", "منع", "ما قدرنا", "delay", "delayed", "late", "stopped", "on hold", "waiting for", "not arrived", "hasn't arrived", "blocked", "cannot proceed", "can't proceed", "no access"], 1.4],
  manpower: [["عامل", "عمال", "فني", "فنيين", "سباك", "سباكين", "كهربائي", "كهربائيين", "لحام", "مساعد", "workers", "technicians", "electricians", "plumbers", "welders", "helpers", "manpower", "labour", "labor"], 0.6],
};
const TRADES = [["electricians", ["كهربائي", "كهربائيين", "electricians", "electrician"]], ["plumbers", ["سباك", "سباكين", "plumbers", "plumber"]], ["duct men", ["فني دكت", "فنيين دكت", "عمال دكت", "duct men", "ductmen", "دكت", "duct"]], ["pipe fitters", ["فيتر", "فيترز", "pipe fitters", "fitters"]], ["welders", ["لحام", "لحامين", "welders", "welder"]], ["helpers", ["مساعد", "مساعدين", "عمال", "عامل", "helpers", "labourers", "laborers", "workers"]], ["technicians", ["فني", "فنيين", "technicians", "technician"]], ["foremen", ["فورمن", "فورمان", "foreman", "foremen"]]];
const DISCIPLINES = [["HVAC", ["تكييف", "دكت", "مجاري الهواء", "تشلر", "fcu", "ahu", "hvac", "duct", "chiller", "chilled water"]], ["Electrical", ["كهرباء", "كهربائي", "الكهربائي", "كهربا", "كيبل", "كيبل تري", "كابلات", "لوحه", "لوحة", "انارة", "اناره", "electrical", "cable", "db", "lighting", "panel"]], ["Plumbing", ["سباكه", "سباكة", "صرف", "مياه", "plumbing", "drainage", "water supply", "sanitary"]], ["Fire fighting", ["حريق", "رشاشات", "سبرنكلر", "fire", "sprinkler", "fire fighting", "hydrant"]], ["Architectural", ["سقف", "فول سيلنج", "جبس", "ceiling", "architectural", "finishes"]], ["Structural", ["خرسانه", "خرسانة", "حديد", "كمرة", "كمره", "slab", "beam", "structural", "concrete"]]];
const DELAY_CAUSES = [["material", ["ما وصل", "ما وصلت", "ماوصلت", "لم تصل", "ماوصل", "لم يصل", "توريد", "المواد", "material", "materials", "not arrived", "delivery", "supplier"]], ["consultant approval", ["اعتماد", "الاستشاري", "موافقه", "approval", "consultant", "submittal"]], ["client", ["المالك", "العميل", "client", "owner"]], ["site access", ["دخول", "تصريح", "access", "permit", "gate"]], ["other trades", ["المقاول", "النجارين", "الخرسانه", "civil", "other trade", "contractor", "scaffold", "سقالات"]], ["weather", ["غبار", "مطر", "حراره", "dust", "rain", "heat", "wind"]]];

function findProject(t, projects, sender) {
  for (const p of projects) if (new RegExp(`(^|[^\\w])${esc(p.code.toLowerCase())}($|[^\\w])`).test(t)) return { p, how: "code" };
  let best = null;
  for (const p of projects) for (const a of String(p.aliases || "").split(",").map(s => normalize(s)).filter(Boolean)) if (t.includes(a) && (!best || a.length > best.len)) best = { p, how: `"${a}"`, len: a.length };
  if (best) return best;
  if (sender?.project_id) { const p = projects.find(x => x.id === sender.project_id); if (p) return { p, how: "assigned" }; }
  return null;
}

function matchCatalog(window, catalog, unit) {
  let best = null;
  for (const c of catalog) {
    const kws = c.keywords.split(",").map(s => normalize(s.trim())).filter(Boolean);
    const hits = kws.filter(k => window.includes(k));
    if (!hits.length) continue;
    const score = hits.reduce((a, k) => a + k.length, 0) + (unit && c.unit === unit ? 6 : 0) + (window.match(/\d+\s*(mm|ملم|مم)/) && kws.some(k => window.includes(k) && /\d/.test(k)) ? 4 : 0);
    if (!best || score > best.score) best = { c, score, hits };
  }
  return best;
}
function matchActivity(window, acts, unit) {
  let best = null;
  for (const a of acts) {
    const kws = a.keywords.split(",").map(s => normalize(s.trim())).filter(Boolean);
    const hits = kws.filter(k => window.includes(k)); if (!hits.length) continue;
    const score = hits.reduce((x, k) => x + k.length, 0) + (unit && a.unit === unit ? 8 : 0);
    if (!best || score > best.score) best = { a, score, hits };
  }
  return best;
}
const sentence = s => String(s).split(/[\n.!؟?]/).map(x => x.trim()).filter(Boolean)[0] || String(s).slice(0, 80);

export function parseFieldMessage(text, { projects, activities, catalog, sender, now = new Date() }) {
  const t = normalize(text); const lang = detectLang(text); const L = (ar, en) => (lang === "ar" ? ar : en);
  const trace = []; const step = (k, label, detail = "") => trace.push({ k, label, detail: String(detail) });
  step("receive", L("رسالة من الموقع", "Message from site"), `${sender?.name || "?"} · ${lang.toUpperCase()}`);

  // project
  const pr = findProject(t, projects, sender);
  if (pr) step("identify", L("المشروع", "Project"), `${pr.p.code} · ${lang === "ar" ? pr.p.name_ar : pr.p.name_en} (${pr.how === "assigned" ? L("المشروع المسند للمرسل", "sender's assigned project") : pr.how === "code" ? L("حسب الكود", "by code") : L("حسب الاسم ", "by name ") + pr.how})`);
  else step("identify", L("المشروع غير محدد", "Project not identified"), L("لا كود ولا اسم مشروع ولا مشروع مسند للمرسل", "no code, no project name, no project assigned to the sender"));

  // classification (several kinds may be present — a daily report often has progress + manpower + a request)
  // "fire fighting pipe" is a trade, not a fire; "no injury" is not an injury
  const tSafe = t.replace(/(مكافحه|مكافحة) ?(ال)?حريق|انذار ?(ال)?حريق|مواسير ?(ال)?حريق|ماسوره ?(ال)?حريق|رشاشات ?(ال)?حريق|fire[ -]?(fighting|pipe|pipes|alarm|sprinkler|sprinklers|pump|hose|damper|rated)/gu, " ")
    .replace(/(no|without|zero) (injury|injuries|one (was )?(hurt|injured))|(بدون|ما في|مافي|لا يوجد|لا توجد|ولا) ?(اي )?(اصابه|اصابات)/gu, " no_injury ");
  const noInjury = /no_injury/.test(tSafe);
  const scores = Object.entries(CUES).map(([k, [ws, w]]) => [k, +(count(k === "safety" ? tSafe : t, ws) * w).toFixed(2)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  const qs = quantities(text);
  if (qs.length && !scores.find(s => s[0] === "progress") && !scores.find(s => s[0] === "material_request")) scores.push(["progress", 0.6]);
  const present = new Set(scores.map(s => s[0]));
  let kind = scores[0]?.[0] || "other";
  if (present.has("safety")) kind = "safety";
  else if (present.has("rfi") && (/\?|؟/.test(text) || has(t, ["rfi", "استفسار", "توضيح", "clarify", "clash", "تعارض"]))) kind = "rfi";
  else if (kind === "manpower" && scores[1]) kind = scores[1][0];
  if (kind === "rfi" && !(/\?|؟/.test(text) || has(t, ["rfi", "استفسار", "توضيح", "clarify", "clarification", "clash", "تعارض", "تضارب", "conflict", "discrepancy"]))) kind = scores.find(s => s[0] !== "rfi" && s[0] !== "manpower")?.[0] || kind;
  const total = scores.reduce((a, s) => a + s[1], 0) || 1;
  const confidence = scores.length ? Math.min(0.98, +(0.45 + 0.55 * (scores.find(s => s[0] === kind)?.[1] || 0) / total).toFixed(2)) : 0.3;
  step("understand", L("نوع الرسالة", "Message type"), `${kind} · ${L("ثقة", "confidence")} ${Math.round(confidence * 100)}%${scores.length > 1 ? ` · ${L("أيضًا", "also")}: ${scores.filter(s => s[0] !== kind).map(s => s[0]).join(", ")}` : ""}`);

  const acts = pr ? activities.filter(a => a.project_id === pr.p.id) : [];
  const out = { lang, kind, confidence, project_id: pr?.p.id ?? null, project_code: pr?.p.code ?? null, progress: [], manpower: [], items: [], rfi: null, incident: null, needed_by: null, trace, unmatched: [] };

  // manpower: "12 كهربائي", "8 plumbers"; ambiguous trade words (دكت, duct) only after a manpower cue ("العمالة 14 دكت")
  const ctxIdx = (/(العماله|عماله|عمال|الطاقم|manpower|workers|labour|labor|crew|team)/u.exec(t) || {}).index;
  const mpText = ctxIdx != null ? t.slice(ctxIdx) : t;
  for (const [trade, ws] of TRADES) for (const w of ws) {
    if (ctxIdx == null && ["duct men", "pipe fitters"].includes(trade) && !/men|فني|عمال/.test(w)) continue;
    const m = new RegExp(`(?:^|[^\\p{L}\\d])(\\d+)\\s*(?:${esc(normalize(w))})(?=$|[^\\p{L}])`, "u").exec(mpText) || new RegExp(`(?:^|[^\\p{L}])(?:${esc(normalize(w))})\\s*(\\d+)(?=$|[^\\d.])(?!\\s*(?:م2|م3|m2|m3|متر|m\\b))`, "u").exec(mpText);
    if (m && !out.manpower.find(x => x.trade === trade)) { out.manpower.push({ trade, count: +m[1] }); break; }
  }
  if (out.manpower.length) step("entities", L("العمالة", "Manpower"), out.manpower.map(m => `${m.trade} ${m.count}`).join(" · "));

  // quantities → progress lines or material items, depending on the verb around them
  const segs = t.split(/[\n,،;]|(?:\s+و\s*(?=\d))|(?:\s+and\s+)/u).map(s => s.trim()).filter(Boolean);
  const reqMode = present.has("material_request") && (kind === "material_request" || has(t, ["نحتاج", "محتاجين", "need", "send", "order", "اطلبوا", "توريد"]));
  const bare = seg => { const m = /(?:^|[^\p{L}\d.x×])(\d{1,5})\s+(?!%)(\p{L}[\p{L} ]{2,})/u.exec(seg); if (!m || quantities(seg).length) return [];
    if (/(الدور|دور|بالدور|للدور|الطابق|طابق|level|floor|lvl|block|بلوك|مبنى|building|زون|zone|غرفه|room)\s*$/u.test(seg.slice(0, m.index + m[0].indexOf(m[1])).trim())) return [];
    return [{ qty: +m[1], unit: "no", raw: m[0], bare: true }]; };
  const progressCue = has(t, CUES.progress[0]) || (kind === "progress" && qs.length > 0);
  for (const seg of segs) {
    const q0 = quantities(seg); const q = q0.length ? q0 : bare(seg); const pct = /(\d{1,3})\s*%/.exec(seg);
    const segReq = reqMode && (has(seg, CUES.material_request[0]) || !has(seg, CUES.progress[0]));
    if (segReq && q.length) {
      for (const x of q) {
        const m = matchCatalog(seg, catalog, x.bare ? null : x.unit);
        if (m) out.items.push({ catalog_id: m.c.id, description: lang === "ar" ? m.c.name_ar : m.c.name_en, qty: x.qty, unit: m.c.unit, category: m.c.category, matched: m.hits.join("+") });
        else out.unmatched.push(seg);
      }
    } else if (!segReq && pr && progressCue && (q.length || pct)) {
      const m = matchActivity(seg, acts, q[0]?.bare ? null : q[0]?.unit);
      if (m) {
        const qty = pct && !q.length ? +(m.a.qty * +pct[1] / 100).toFixed(1) : q.find(x => x.unit === m.a.unit)?.qty ?? (q[0]?.bare || q[0]?.unit === m.a.unit ? q[0]?.qty : null);
        if (qty) out.progress.push({ activity_id: m.a.id, code: m.a.code, name: lang === "ar" ? m.a.name_ar : m.a.name_en, qty, unit: m.a.unit, matched: m.hits.join("+"), from_pct: !!(pct && !q.length) });
      } else if (q.length && !out.manpower.length) out.unmatched.push(seg);
    }
  }
  // a request with no explicit quantities: still pick the materials named
  if (reqMode && !out.items.length) for (const seg of segs) { const m = matchCatalog(seg, catalog, null); if (m) out.items.push({ catalog_id: m.c.id, description: lang === "ar" ? m.c.name_ar : m.c.name_en, qty: null, unit: m.c.unit, category: m.c.category, matched: m.hits.join("+") }); }
  if (out.progress.length) step("entities", L("إنجاز مستخرج", "Progress extracted"), out.progress.map(p => `${p.code} ${p.name}: +${p.qty} ${p.unit}${p.from_pct ? " (من %)" : ""}`).join(" · "));
  if (out.items.length) step("entities", L("مواد مطلوبة", "Materials requested"), out.items.map(i => `${i.description}: ${i.qty ?? "?"} ${i.unit}`).join(" · "));
  if (out.unmatched.length) step("warn", L("أجزاء لم تُفهم", "Parts not understood"), out.unmatched.join(" | "));

  // dates
  const dates = findDates(text, now);
  if (out.items.length) {
    const d = dates[0] ? new Date(dates[0]) : null;
    out.needed_by = d && d >= new Date(iso(now)) ? iso(d) : iso(new Date(now.getTime() + 3 * 864e5));
    step("entities", L("مطلوب قبل", "Needed by"), out.needed_by + (dates[0] ? "" : L(" (افتراضي: 3 أيام)", " (default: 3 days)")));
  }
  // RFI
  if (kind === "rfi" || (present.has("rfi") && /\?|؟/.test(text))) {
    const disc = DISCIPLINES.map(([d, ws]) => [d, count(t, ws)]).filter(x => x[1]).sort((a, b) => b[1] - a[1])[0]?.[0] || "General";
    const loc = /(?:الدور|دور|الطابق|طابق|level|floor|lvl)\s*(\w+)/iu.exec(text)?.[0] || /\b(B\d|L\d{1,2}|GF|roof|السطح|البدروم)\b/iu.exec(text)?.[0] || null;
    out.rfi = { subject: sentence(text).slice(0, 90), question: String(text).trim(), discipline: disc, location: loc };
    step("entities", "RFI", `${disc}${loc ? " · " + loc : ""} · ${out.rfi.subject}`);
  }
  // safety / delay
  if (kind === "safety" || present.has("safety")) {
    const sev = noInjury || has(t, ["near miss", "كاد", "كادت", "تقريبا", "unsafe", "بدون اصابه"]) ? "low" : has(tSafe, ["اصابه", "اصابة", "انصاب", "اسعاف", "مستشفى", "injury", "injured", "hospital", "ambulance", "fire", "حريق", "صعقه", "electric shock"]) ? "high" : "medium";
    out.incident = { kind: "safety", severity: sev, description: String(text).trim() };
    step("rule", L("بلاغ سلامة", "Safety report"), `${L("الخطورة", "severity")}: ${sev}${sev === "high" ? L(" → إشعار فوري لمدير المشروع والمالك", " → immediate alert to PM and owner") : ""}`);
  } else if (kind === "delay" || present.has("delay")) {
    const cause = DELAY_CAUSES.find(([, ws]) => has(t, ws))?.[0] || "unspecified";
    const days = extractDuration(text);
    out.incident = { kind: "delay", severity: days && days >= 3 ? "high" : "medium", cause, delay_days: days, description: String(text).trim() };
    step("rule", L("تسجيل تأخير", "Delay logged"), `${L("السبب", "cause")}: ${L(CAUSE_AR[cause] || cause, cause)}${days ? ` · ${days} ${L("يوم", "days")}` : ""} → ${L("سجل التأخيرات (دليل لمطالبات التمديد)", "delay register (evidence for extension-of-time claims)")}`);
  }

  // routing
  const route = [];
  if (out.progress.length) route.push(["pm", L("تحديث الإنجاز", "progress update")]);
  if (out.items.length) route.push(["procurement", L("طلب مواد", "material request")]);
  if (out.rfi) route.push(["pm", "RFI"]);
  if (out.incident?.kind === "safety") { if (out.incident.severity === "high") route.push(["owner", L("سلامة", "safety")]); route.push(["pm", L("سلامة", "safety")]); }
  if (out.incident?.kind === "delay") route.push(["pm", L("تأخير", "delay")]);
  out.route = route;
  if (route.length) step("route", L("التوجيه", "Routing"), route.map(([r, w]) => `${r} ← ${w}`).join(" · "));
  out.needs_review = !pr || (!route.length && !out.manpower.length) || confidence < 0.5;
  if (out.needs_review) step("rule", L("يحتاج مراجعة", "Needs review"), !pr ? L("حدد المشروع", "pick the project") : L("لم أستخرج سجلات واضحة", "no clear records extracted"));
  if (lang === "ar") for (const x of trace) x.detail = x.detail.replace(/(^|[^\d])(\d+) يوم/g, (m, p, n) => (+n === 1 ? `${p}يوم واحد` : +n === 2 ? `${p}يومين` : +n <= 10 ? `${p}${n} أيام` : m));
  return out;
}

export function replyFor(r, { mrNo, rfiNo, applied }) {
  const L = (ar, en) => (r.lang === "ar" ? ar : en); const parts = [];
  if (!r.project_id) return L("وصلت رسالتك 👍 لأي مشروع؟ اكتب كود المشروع أو اسمه.", "Got it 👍 Which project is this for? Send the project code or name.");
  if (r.progress.length) parts.push(L(`سجلت الإنجاز: ${r.progress.map(p => `${p.name} +${p.qty} ${p.unit}`).join("، ")} ✅`, `Progress logged: ${r.progress.map(p => `${p.name} +${p.qty} ${p.unit}`).join(", ")} ✅`));
  if (r.manpower.length) parts.push(L(`العمالة اليوم: ${r.manpower.reduce((a, m) => a + m.count, 0)}`, `Manpower today: ${r.manpower.reduce((a, m) => a + m.count, 0)}`));
  if (mrNo) parts.push(L(`فتحت طلب مواد ${mrNo} وأرسلت طلب تسعير للموردين — المطلوب قبل ${r.needed_by}. بأبلغك أول ما يصدر أمر الشراء.`, `Opened material request ${mrNo} and sent an RFQ to suppliers — needed by ${r.needed_by}. I'll tell you when the PO is issued.`));
  if (rfiNo) parts.push(L(`سجلت الاستفسار ${rfiNo} وأرسلته لمدير المشروع لرفعه للاستشاري.`, `Logged ${rfiNo} and sent it to the PM to raise with the consultant.`));
  if (r.incident?.kind === "safety") parts.push(r.incident.severity === "high" ? L("⚠️ تم إبلاغ مدير المشروع والإدارة فورًا. تأكد من الإسعافات وأوقف العمل في المنطقة لحين التقييم.", "⚠️ PM and management alerted immediately. Make sure first aid is given and stop work in the area until it is assessed.") : L("تم تسجيل بلاغ السلامة وإبلاغ مدير المشروع.", "Safety report logged and sent to the PM."));
  if (r.incident?.kind === "delay") parts.push(L("سجلت التأخير في سجل التأخيرات مع السبب والتاريخ، وأبلغت مدير المشروع.", "Delay recorded in the delay register with cause and date; PM informed."));
  if (r.unmatched.length) parts.push(L(`ما فهمت: «${r.unmatched[0]}» — ممكن توضح البند؟`, `I couldn't map: "${r.unmatched[0]}" — can you clarify the item?`));
  if (!parts.length) parts.push(L("وصلت رسالتك 👍 حولتها لمدير المشروع.", "Received 👍 passed to the PM."));
  return parts.join("\n");
}
