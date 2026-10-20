// Sample data: two fictional contractors. Progress, costs and invoices are generated so that earned-value
// figures behave like real projects (some behind, some over budget); field messages, material requests,
// quotes and estimates are produced by running the actual AI agents. All names and figures are invented.
import { processFieldMessage, sendRfq, issuePo } from "./service.js";
import { buildEstimate } from "./ai/estimator.js";
import { isoDay } from "./metrics.js";

export const DEMO_HASH = "pbkdf2$100000$736974656c6f672d64656d6f2d73616c74$c1518516014ed00eeb9fbc27d1c19b37b424ccc30559442d91dd95fbc6a52a89";
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const stamp = (d, h = 9, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return `${isoDay(x)} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`; };
const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };

// activity library: code, en, ar, keywords, unit, rate (SAR per unit of budget)
const LIB = {
  DCT: ["HVAC ductwork", "أعمال مجاري الهواء (الدكت)", "دكت,مجاري الهواء,duct,ductwork,ducting", "m2", 210],
  CHW: ["Chilled water piping", "مواسير المياه المثلجة", "مياه مثلجه,مواسير التشلر,مواسير تشلر,تشلر,chilled water,chw", "m", 520],
  FCU: ["Fan coil units", "وحدات الفان كويل", "فان كويل,fcu,fan coil,fan coils", "no", 4800],
  AHU: ["Air handling units", "وحدات مناولة الهواء", "ahu,air handling,وحدات مناوله", "no", 68000],
  CBL: ["Power cable pulling", "سحب الكابلات", "كيبل,كابل,كابلات,cable,cables", "m", 95],
  CTR: ["Cable trays", "حوامل الكابلات", "كيبل تري,حوامل الكابلات,cable tray,cable trays,tray", "m", 160],
  DB: ["Distribution boards", "لوحات التوزيع", "لوحه,لوحات,لوحات التوزيع,db,dbs,distribution board,distribution boards", "no", 7200],
  LTG: ["Lighting fixtures", "وحدات الإنارة", "اناره,لمبات,كشاف,كشافات,led,lighting,light fittings,fixtures", "no", 420],
  FFP: ["Fire fighting piping", "مواسير مكافحة الحريق", "مواسير الحريق,مكافحه الحريق,fire pipe,fire fighting pipe,fire fighting,ff pipe", "m", 310],
  SPK: ["Sprinkler heads", "رشاشات الحريق", "رشاش,رشاشات,سبرنكلر,sprinkler,sprinklers", "no", 260],
  PLB: ["Plumbing & drainage piping", "تمديدات السباكة والصرف", "سباكه,صرف,تمديدات,ppr,upvc,plumbing,drainage", "m", 140],
  SAN: ["Sanitary fixtures", "الأدوات الصحية", "ادوات صحيه,مغاسل,كراسي,sanitary,wc,basins", "no", 1900],
  FAL: ["Fire alarm devices", "أجهزة إنذار الحريق", "انذار,كواشف,كاشف,smoke detector,detectors,fire alarm", "no", 380],
  TNC: ["Testing & commissioning", "الاختبار والتشغيل", "اختبار وتشغيل,تشغيل,testing,commissioning,t&c", "ls", 0],
};
const PROJECTS_T1 = [
  { code: "P-2401", en: "Al-Yasmin Residential Tower — MEP works", ar: "برج الياسمين السكني — أعمال كهروميكانيكية", aliases: "برج الياسمين,الياسمين,yasmin tower,yasmin", client: "Dar Al-Yasmin Real Estate", consultant: "Meyar Engineering Consultants", city: "Riyadh", contract: 18500000, start: -300, end: 165, spi: 0.82, cpi: 0.93,
    acts: { DCT: 9800, CHW: 4200, FCU: 310, CBL: 26000, DB: 64, LTG: 2900, FFP: 3600, SPK: 2100, PLB: 7400, SAN: 520, TNC: 1 }, engineer: "bilal" },
  { code: "P-2402", en: "Al-Noor Specialist Clinics — HVAC & fire fighting", ar: "مجمع عيادات النور — تكييف ومكافحة حريق", aliases: "عيادات النور,مجمع النور,النور,noor clinic,noor clinics,al-noor,noor", client: "Al-Noor Medical Holding", consultant: "Saqf Consult", city: "Riyadh", contract: 9200000, start: -200, end: 120, spi: 1.03, cpi: 1.04,
    acts: { DCT: 6200, CHW: 2600, FCU: 180, AHU: 6, FFP: 2900, SPK: 1650, FAL: 900, TNC: 1 }, engineer: "karim" },
  { code: "P-2403", en: "Riyadh Front Office Building B — electrical", ar: "مبنى المكاتب B — أعمال كهربائية", aliases: "مبنى المكاتب,مبنى b,office b,building b,office building", client: "Front Gate Developments", consultant: "Meyar Engineering Consultants", city: "Riyadh", contract: 6800000, start: -150, end: 90, spi: 0.93, cpi: 0.86,
    acts: { CBL: 31000, CTR: 4200, DB: 96, LTG: 3800, FAL: 1200, TNC: 1 }, engineer: "yasser" },
  { code: "P-2404", en: "Al-Malqa International School — MEP", ar: "مدرسة الملقا العالمية — أعمال كهروميكانيكية", aliases: "مدرسة الملقا,الملقا,malqa school,malqa", client: "Malqa Education Co.", consultant: "Bayt Al-Khibra Consultants", city: "Riyadh", contract: 12100000, start: -95, end: 240, spi: 1.04, cpi: 1.01,
    acts: { DCT: 7400, CHW: 2100, FCU: 240, CBL: 18000, DB: 48, LTG: 2600, FFP: 2400, SPK: 1500, PLB: 5200, SAN: 380, TNC: 1 }, engineer: "fahad" },
  { code: "P-2405", en: "Warehouse 7 Sudair — fire fighting", ar: "مستودع 7 سدير — مكافحة حريق", aliases: "مستودع 7,المستودع,warehouse 7,sudair,سدير", client: "Sudair Logistics Park", consultant: "Saqf Consult", city: "Sudair", contract: 3400000, start: -330, end: -20, spi: 0.97, cpi: 1.01, status: "handover",
    acts: { FFP: 4200, SPK: 2600, FAL: 600, TNC: 1 }, engineer: null },
];
const SUPPLIERS_T1 = [
  ["Gulf Duct Industries", "duct,insulation", "Riyadh", 4.4, "30 days", 1.02, 6, 0.93], ["Najd Pipes Trading", "pipes,valves,fire", "Riyadh", 4.1, "45 days", 0.96, 9, 0.84],
  ["Al-Watania Cables & Wires", "cables,electrical", "Dammam", 4.6, "30 days", 1.0, 5, 0.95], ["Riyadh HVAC Equipment Co.", "hvac_equipment,duct,pipes", "Riyadh", 4.0, "60 days", 0.93, 14, 0.8],
  ["Eastern Electrical Supplies", "electrical,lighting,cables", "Khobar", 4.3, "45 days", 0.97, 7, 0.9], ["Saudi Fire Systems Supply", "fire,valves", "Riyadh", 4.5, "30 days", 1.05, 4, 0.96],
  ["Arabian Valves & Fittings", "valves,pipes,sanitary", "Jeddah", 3.8, "60 days", 0.91, 12, 0.78], ["Lumen Arabia Lighting", "lighting", "Riyadh", 4.2, "30 days", 1.03, 8, 0.91],
];
const CATALOG_T1 = [
  ["GI-SHT", "صاج مجلفن للدكت", "GI duct sheet", "duct", "m2", 62, "صاج,صاج مجلفن,دكت,duct sheet,gi sheet,galvanized"], ["DUCT-INS", "عزل الدكت 25 ملم", "Duct insulation 25mm", "insulation", "m2", 38, "عزل,عزل الدكت,insulation,duct insulation"],
  ["CHW-4", "ماسورة حديد 4 انش (تشلر)", "Steel pipe 4\" (chilled water)", "pipes", "m", 118, "مواسير 4 انش,ماسوره 4 انش,4 انش,4\",4 inch,steel pipe,مواسير التشلر,مواسير تشلر,chilled water pipe"],
  ["CHW-2", "ماسورة حديد 2 انش", "Steel pipe 2\"", "pipes", "m", 54, "2 انش,2\",2 inch"], ["PPR-32", "ماسورة PPR قطر 32 ملم", "PPR pipe 32mm", "pipes", "m", 14, "ppr,بي بي ار,32 ملم,32mm"],
  ["UPVC-110", "ماسورة UPVC قطر 110 ملم", "UPVC pipe 110mm", "pipes", "m", 21, "upvc,صرف,110 ملم,110mm"], ["GV-4", "محبس بوابة 4 انش", "Gate valve 4\"", "valves", "no", 640, "محبس,محابس,gate valve,valve,valves"],
  ["FCU-2T", "وحدة فان كويل 2 طن", "Fan coil unit 2TR", "hvac_equipment", "no", 3100, "فان كويل,fcu,fan coil"], ["CBL-4X16", "كيبل 4×16 مم²", "Cable 4x16mm²", "cables", "m", 46, "4x16,4×16,كيبل 4x16,كابل 4x16,16 مم,cable 4x16"],
  ["CBL-4X95", "كيبل 4×95 مم²", "Cable 4x95mm²", "cables", "m", 238, "4x95,4×95,95 مم,cable 4x95"], ["CBL-3X2.5", "كيبل 3×2.5 مم²", "Cable 3x2.5mm²", "cables", "m", 7.5, "2.5,3x2.5,كيبل انارة,lighting cable"],
  ["CT-300", "كيبل تري 300 ملم", "Cable tray 300mm", "electrical", "m", 74, "كيبل تري,حوامل,cable tray,tray"], ["DB-24", "لوحة توزيع 24 خط", "Distribution board 24-way", "electrical", "no", 2650, "لوحه توزيع,لوحات توزيع,لوحه,لوحات,24 خط,db,distribution board"],
  ["LED-6060", "كشاف LED بانل 60×60", "LED panel 60x60", "lighting", "no", 165, "كشاف,كشافات,led,بانل,panel light,60x60"], ["LED-DL", "سبوت لايت LED", "LED downlight", "lighting", "no", 58, "سبوت,downlight,down light"],
  ["FF-2", "ماسورة حريق 2 انش sch40", "Fire pipe 2\" sch40", "fire", "m", 49, "ماسوره حريق,مواسير حريق,مواسير الحريق,fire pipe,sch40"], ["SPK-P", "رشاش حريق معلق", "Sprinkler head pendent", "fire", "no", 34, "رشاش,رشاشات,سبرنكلر,sprinkler,sprinklers"],
  ["FA-SD", "كاشف دخان", "Smoke detector", "fire", "no", 118, "كاشف دخان,كواشف,smoke detector,detectors"], ["WC-SET", "طقم مرحاض معلق", "Wall-hung WC set", "sanitary", "no", 980, "كرسي,مرحاض,wc,toilet"],
  ["BSN", "مغسلة رخام", "Wash basin", "sanitary", "no", 420, "مغسله,مغاسل,basin,basins"], ["CONDUIT-25", "ماسورة PVC للكهرباء 25 ملم", "PVC conduit 25mm", "electrical", "m", 3.2, "ليات,مواسير كهرباء,conduit,pvc conduit"],
];
const COSTDB_T1 = [
  ["HV-01", "HVAC", "GI ductwork supply & install incl. supports", "توريد وتركيب دكت مجلفن شامل التعليقات", "m2", 118, 72, 8, "duct,ductwork,ducting,دكت,مجاري هواء,gi duct", "14"],
  ["HV-02", "HVAC", "Duct thermal insulation 25mm", "عزل حراري للدكت 25 ملم", "m2", 42, 18, 0, "insulation,عزل", "30"],
  ["HV-03", "HVAC", "Chilled water steel pipe 4\" insulated", "مواسير مياه مثلجة 4 انش معزولة", "m", 205, 120, 15, "chilled water,chw,4\",4 inch,مياه مثلجه,4 انش", "9"],
  ["HV-04", "HVAC", "Chilled water steel pipe 2\" insulated", "مواسير مياه مثلجة 2 انش معزولة", "m", 98, 70, 10, "2\",2 inch,2 انش", "14"],
  ["HV-05", "HVAC", "Fan coil unit 2TR ducted, installed & connected", "وحدة فان كويل 2 طن مع التوصيل", "no", 3300, 900, 50, "fcu,fan coil,فان كويل", "1.5"],
  ["HV-06", "HVAC", "Air handling unit 10,000 cfm installed", "وحدة مناولة هواء 10,000 قدم³/د", "no", 54000, 9000, 4000, "ahu,air handling,مناوله هواء", "0.2"],
  ["HV-07", "HVAC", "Split unit 2TR supply & install", "مكيف سبليت 2 طن توريد وتركيب", "no", 2600, 450, 0, "split,سبليت,split unit", "2"],
  ["HV-08", "HVAC", "Exhaust fan 300 l/s", "مروحة شفط 300 لتر/ث", "no", 1400, 380, 0, "exhaust fan,شفاط,مروحه شفط", "3"],
  ["EL-01", "Electrical", "Power cable 4x16mm² Cu/XLPE pulled in tray", "كيبل 4×16 نحاس XLPE سحب على الحوامل", "m", 52, 14, 3, "4x16,16mm,16 mm2,cable 4x16,كيبل 4x16", "120"],
  ["EL-02", "Electrical", "Power cable 4x95mm² Cu/XLPE", "كيبل 4×95 نحاس XLPE", "m", 255, 38, 8, "4x95,95mm,95 mm2,كيبل 4x95", "60"],
  ["EL-03", "Electrical", "Lighting circuit wiring 3x2.5mm² in conduit", "تمديد دوائر إنارة 3×2.5 داخل ليات", "m", 11, 9, 0, "2.5,lighting circuit,wiring,دوائر اناره,تمديد", "180"],
  ["EL-04", "Electrical", "Cable tray 300mm perforated incl. supports", "حوامل كابلات 300 ملم مثقبة مع التعليق", "m", 82, 34, 4, "cable tray,tray,حوامل,كيبل تري", "40"],
  ["EL-05", "Electrical", "Distribution board 24-way installed & terminated", "لوحة توزيع 24 خط تركيب وتوصيل", "no", 2800, 650, 0, "distribution board,db,لوحه توزيع,لوحات", "2"],
  ["EL-06", "Electrical", "LED panel 60x60 40W installed", "كشاف LED بانل 60×60 تركيب", "no", 175, 45, 0, "led panel,60x60,panel,كشاف,بانل,light fitting,lighting fixture", "25"],
  ["EL-07", "Electrical", "LED downlight 12W installed", "سبوت LED 12 واط تركيب", "no", 62, 28, 0, "downlight,spot,سبوت", "35"],
  ["EL-08", "Electrical", "Wiring device (socket / switch) installed", "أفياش ومفاتيح تركيب", "no", 38, 22, 0, "socket,switch,sockets,switches,افياش,مفاتيح,فيش", "30"],
  ["EL-09", "Electrical", "Main distribution panel 1600A", "لوحة رئيسية 1600 أمبير", "no", 165000, 12000, 3000, "mdb,main distribution,1600a,لوحه رئيسيه", "0.1"],
  ["FF-01", "Fire fighting", "Fire fighting pipe 2\" sch40 grooved, painted", "مواسير حريق 2 انش sch40 مع الدهان", "m", 68, 52, 6, "fire pipe,fire fighting pipe,sch40,مواسير حريق,حريق", "18"],
  ["FF-02", "Fire fighting", "Fire fighting pipe 4\" sch40", "مواسير حريق 4 انش sch40", "m", 140, 75, 10, "4\" fire,fire main,4 inch fire", "12"],
  ["FF-03", "Fire fighting", "Sprinkler head pendent with drop", "رشاش حريق معلق مع التوصيلة", "no", 48, 30, 0, "sprinkler,sprinklers,رشاش,رشاشات", "30"],
  ["FF-04", "Fire fighting", "Fire hose cabinet complete", "صندوق خرطوم حريق كامل", "no", 2400, 450, 0, "fire hose,hose cabinet,صندوق حريق,fhc", "3"],
  ["FF-05", "Fire fighting", "Smoke detector addressable installed", "كاشف دخان معنون تركيب", "no", 135, 40, 0, "smoke detector,detector,كاشف دخان,كواشف", "20"],
  ["FF-06", "Fire fighting", "Fire pump set UL/FM 500gpm", "مجموعة مضخات حريق 500 جالون/د", "set", 210000, 18000, 6000, "fire pump,مضخه حريق,pump set", "0.05"],
  ["PL-01", "Plumbing", "PPR water supply pipe 32mm", "مواسير تغذية PPR قطر 32", "m", 17, 15, 0, "ppr,water supply,تغذيه,32mm", "45"],
  ["PL-02", "Plumbing", "UPVC drainage pipe 110mm", "مواسير صرف UPVC قطر 110", "m", 26, 20, 0, "upvc,drainage,صرف,110mm", "35"],
  ["PL-03", "Plumbing", "Wall-hung WC complete installed", "كرسي معلق كامل تركيب", "no", 1050, 280, 0, "wc,toilet,water closet,كرسي,مرحاض", "3"],
  ["PL-04", "Plumbing", "Wash basin with mixer installed", "مغسلة مع خلاط تركيب", "no", 520, 160, 0, "basin,wash basin,lavatory,مغسله", "4"],
  ["PL-05", "Plumbing", "Water heater 80L installed", "سخان مياه 80 لتر تركيب", "no", 780, 140, 0, "water heater,heater,سخان", "4"],
  ["GN-01", "General", "Testing, commissioning & handover documents", "الاختبار والتشغيل ومستندات التسليم", "ls", 0, 45000, 8000, "testing,commissioning,t&c,اختبار,تشغيل", null],
];

const PROJECTS_T2 = [
  { code: "LF-11", en: "Sky Business Lounge — interior fit-out", ar: "صالة سكاي للأعمال — تشطيبات داخلية", aliases: "سكاي,sky lounge,sky", client: "Sky Hospitality", consultant: "Nuqta Design", city: "Jeddah", contract: 2400000, start: -60, end: 75, spi: 0.95, cpi: 0.98,
    acts: { GYP: 1800, FLR: 1400, PNT: 4200, JNR: 36 } },
  { code: "LF-12", en: "Harbour Clinic — reception & offices", ar: "عيادة الميناء — الاستقبال والمكاتب", aliases: "الميناء,harbour,harbour clinic", client: "Harbour Medical", consultant: "Nuqta Design", city: "Jeddah", contract: 1100000, start: -30, end: 60, spi: 1.0, cpi: 1.02,
    acts: { GYP: 650, FLR: 520, PNT: 1500, JNR: 14 } },
];
const LIB2 = { GYP: ["Gypsum board ceilings", "أسقف جبس بورد", "جبس,جبس بورد,سقف,اسقف,gypsum,ceiling,ceilings", "m2", 95], FLR: ["Porcelain flooring", "أرضيات بورسلان", "بورسلان,بلاط,ارضيات,porcelain,flooring,tiles", "m2", 170], PNT: ["Painting", "الدهانات", "دهان,دهانات,بوية,paint,painting", "m2", 32], JNR: ["Joinery items", "أعمال النجارة", "نجاره,ابواب,خزائن,joinery,doors,cabinets", "no", 6800] };

export function applySeed(dbx, { today = new Date() } = {}) {
  const now = new Date(today); const rand = rng(424242); const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const run = (s, p) => dbx.run(s, p);
  dbx.tx(() => {
    for (const t of ["audit_log", "ai_questions", "approvals", "estimates", "cost_db", "purchase_orders", "quotes", "mr_items", "material_requests", "catalog", "suppliers", "incidents", "rfis", "field_messages", "manpower", "invoices", "costs", "progress_entries", "activities", "projects", "users", "tenants"]) run(`DELETE FROM ${t}`);
    run("DELETE FROM sqlite_sequence");
    const T1 = run("INSERT INTO tenants (slug,name_ar,name_en,trade,city,cr_no,vat_no,plan,created_at) VALUES (?,?,?,?,?,?,?,?,?)", ["watad", "شركة وتد للمقاولات الكهروميكانيكية", "Watad MEP Contracting Co.", "MEP", "Riyadh", "10100XXXXX", "3000XXXXXXXXXX3", "growth", stamp(addDays(now, -400))]).lastId;
    const T2 = run("INSERT INTO tenants (slug,name_ar,name_en,trade,city,cr_no,vat_no,plan,created_at) VALUES (?,?,?,?,?,?,?,?,?)", ["lamsa", "لمسة للتشطيبات الداخلية", "Lamsa Fit-Out & Interiors", "Fit-out", "Jeddah", "40300XXXXX", "3001XXXXXXXXXX3", "starter", stamp(addDays(now, -90))]).lastId;
    const U = {};
    for (const [k, t, name, email, role, phone] of [
      ["owner", T1, "Saud Al-Harbi", "owner@watad.example", "owner", "+9665XX100001"], ["pm", T1, "Eng. Hani Fawzi", "pm@watad.example", "pm", "+9665XX100002"],
      ["proc", T1, "Rana Al-Hamad", "procurement@watad.example", "procurement", "+9665XX100003"], ["est", T1, "Eng. Omar Siddiqui", "estimator@watad.example", "estimator", "+9665XX100004"],
      ["bilal", T1, "Eng. Bilal Ahmed", "bilal@watad.example", "site_engineer", "+9665XX100011"], ["karim", T1, "Eng. Karim Nabil", "karim@watad.example", "site_engineer", "+9665XX100012"],
      ["yasser", T1, "Eng. Yasser Adel", "yasser@watad.example", "site_engineer", "+9665XX100013"], ["fahad", T1, "Eng. Fahad Al-Otaibi", "fahad@watad.example", "site_engineer", "+9665XX100014"],
      ["viewer", T1, "Board member (read-only)", "board@watad.example", "viewer", null],
      ["owner2", T2, "Maha Al-Zahrani", "owner@lamsa.example", "owner", "+9665XX200001"], ["pm2", T2, "Eng. Tamer Hosny", "pm@lamsa.example", "pm", "+9665XX200002"],
    ]) U[k] = run("INSERT INTO users (tenant_id,name,email,phone,role,password_hash) VALUES (?,?,?,?,?,?)", [t, name, email, phone, role, DEMO_HASH]).lastId;

    const mkProjects = (tenant, list, lib, pm) => list.map(P => {
      const start = addDays(now, P.start), end = addDays(now, P.end);
      const budget = Math.round(P.contract * 0.87 / 1000) * 1000;
      const pid = run("INSERT INTO projects (tenant_id,code,name_ar,name_en,aliases,client,consultant,city,scope,contract_value,budget,start_date,end_date,status,pm_user_id,engineer_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [tenant, P.code, P.ar, P.en, P.aliases, P.client, P.consultant, P.city, Object.keys(P.acts).map(k => lib[k][0]).join(", "), P.contract, budget, isoDay(start), isoDay(end), P.status || "active", pm, P.engineer ? U[P.engineer] : null]).lastId;
      // budget split by library rate, T&C gets 3%
      const raw = Object.entries(P.acts).map(([k, q]) => [k, q, k === "TNC" ? 0 : q * lib[k][4]]); const rawSum = raw.reduce((a, r) => a + r[2], 0);
      const keys = Object.keys(P.acts); const dur = (end - start) / 864e5;
      const acts = raw.map(([k, q, r], i) => {
        const share = k === "TNC" ? 0.03 : (r / rawSum) * 0.97;
        // staggered windows: first-fix earlier, finishes and T&C later
        const f0 = k === "TNC" ? 0.86 : Math.min(0.55, (i / keys.length) * 0.55), f1 = k === "TNC" ? 1 : Math.min(0.95, f0 + 0.42 + rand() * 0.12);
        const ps = addDays(start, Math.round(dur * f0)), pe = addDays(start, Math.round(dur * f1));
        const id = run("INSERT INTO activities (project_id,code,name_ar,name_en,keywords,unit,qty,budget_cost,planned_start,planned_end) VALUES (?,?,?,?,?,?,?,?,?,?)", [pid, k, lib[k][1], lib[k][0], lib[k][2], lib[k][3], q, Math.round(budget * share), isoDay(ps), isoDay(pe)]).lastId;
        return { id, k, q, ps, pe, budget: budget * share };
      });
      // progress: weekly entries following the planned curve × target SPI (with per-activity noise)
      let ev = 0; const weekly = {};
      for (const a of acts) {
        const noise = P.status === "handover" ? 1 : Math.max(0.55, Math.min(1.25, P.spi * (0.85 + rand() * 0.3)));
        let done = 0;
        for (let d = new Date(a.ps); d <= now; d = addDays(d, 7)) {
          const frac = Math.min(1, (d - a.ps) / Math.max(1, a.pe - a.ps)); const target = Math.min(a.q, a.q * frac * noise * (P.status === "handover" ? (a.k === "TNC" ? 0.8 : 1.02) : 1));
          const inc = +(target - done).toFixed(a.q < 50 ? 0 : 1); if (inc <= 0) continue;
          if (a.k === "TNC" && inc < 1 && a.q === 1) { const v = +Math.max(0, target - done).toFixed(2); if (v > 0) { run("INSERT INTO progress_entries (activity_id,date,qty,note) VALUES (?,?,?,?)", [a.id, isoDay(d), v, "weekly report"]); done += v; } continue; }
          run("INSERT INTO progress_entries (activity_id,date,qty,note) VALUES (?,?,?,?)", [a.id, isoDay(d), inc, "weekly report"]); done += inc;
          const wk = isoDay(d).slice(0, 7); weekly[wk] = (weekly[wk] || 0) + inc * a.budget / a.q;
        }
        ev += Math.min(done, a.q) * a.budget / a.q;
      }
      // costs per month = earned / CPI, split by category
      const split = [["material", 0.46], ["labor", 0.29], ["subcontract", 0.12], ["equipment", 0.05], ["overhead", 0.08]];
      for (const [m, earned] of Object.entries(weekly)) for (const [cat, sh] of split) {
        const amt = Math.round(earned / P.cpi * sh * (0.92 + rand() * 0.16)); if (amt > 0) run("INSERT INTO costs (project_id,date,category,amount,ref,note) VALUES (?,?,?,?,?,?)", [pid, `${m}-${String(between(20, 27)).padStart(2, "0")}`, cat, amt, `${cat.slice(0, 3).toUpperCase()}-${m.replace("-", "")}`, "monthly cost booking"]);
      }
      // monthly progress invoices (contract value of earned work, 10% retention), paid after ~45-75 days
      let n = 0; for (const [m, earned] of Object.entries(weekly).sort()) {
        const date = `${m}-28`; const amt = Math.round(earned * (P.contract / budget) * 0.9); if (amt < 1000) continue; n++;
        const due = isoDay(addDays(new Date(date), 60)); const paid = new Date(due) < addDays(now, -between(-20, 25));
        run("INSERT INTO invoices (project_id,no,date,amount,due_date,paid_date,status) VALUES (?,?,?,?,?,?,?)", [pid, `${P.code}-IPC${String(n).padStart(2, "0")}`, date, amt, due, paid ? isoDay(addDays(new Date(due), between(-5, 20))) : null, paid ? "paid" : "issued"]);
      }
      // manpower: last 3 weeks (no Fridays)
      if (P.status !== "handover") for (let d = 21; d >= 1; d--) { const day = addDays(now, -d); if (day.getDay() === 5) continue;
        const base = Math.round(P.contract / 450000);
        for (const [trade, sh] of [["duct men", 0.25], ["pipe fitters", 0.25], ["electricians", 0.3], ["helpers", 0.2]]) { const c = Math.round(base * sh * (0.8 + rand() * 0.4)); if (c) run("INSERT INTO manpower (project_id,date,trade,count) VALUES (?,?,?,?)", [pid, isoDay(day), trade, c]); } }
      return { pid, P };
    });
    const projs1 = mkProjects(T1, PROJECTS_T1, LIB, U.pm);
    mkProjects(T2, PROJECTS_T2, LIB2, U.pm2);

    for (const [name, cats, city, rating, terms, pf, lead, ot] of SUPPLIERS_T1) run("INSERT INTO suppliers (tenant_id,name,categories,city,rating,payment_terms,phone,email,price_factor,lead_days,on_time_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [T1, name, cats, city, rating, terms, "+9661XX" + between(100000, 999999), `sales@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`, pf, lead, ot]);
    for (const [code, ar, en, cat, unit, price, kw] of CATALOG_T1) run("INSERT INTO catalog (tenant_id,code,name_ar,name_en,category,unit,ref_price,keywords) VALUES (?,?,?,?,?,?,?,?)", [T1, code, ar, en, cat, unit, price, kw]);
    for (const r of COSTDB_T1) run("INSERT INTO cost_db (tenant_id,code,trade,description,description_ar,unit,material,labor,equipment,keywords,productivity) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [T1, ...r]);
    for (const [name, cats, rating] of [["Red Sea Gypsum Works", "gypsum", 4.2], ["Ceramica Jeddah", "flooring", 4.4], ["Hejaz Paints Supply", "paint", 4.0]]) run("INSERT INTO suppliers (tenant_id,name,categories,city,rating,payment_terms,price_factor,lead_days,on_time_rate) VALUES (?,?,?,?,?,?,?,?,?)", [T2, name, cats, "Jeddah", rating, "30 days", 1, 5, 0.9]);
    for (const [code, ar, en, cat, unit, price, kw] of [["GYP-12", "لوح جبس 12.5 ملم", "Gypsum board 12.5mm", "gypsum", "m2", 18, "جبس,gypsum,board"], ["POR-60", "بورسلان 60×60", "Porcelain 60x60", "flooring", "m2", 55, "بورسلان,porcelain,بلاط,tiles"], ["PNT-EM", "دهان إيملشن", "Emulsion paint", "paint", "m2", 9, "دهان,paint,emulsion"]]) run("INSERT INTO catalog (tenant_id,code,name_ar,name_en,category,unit,ref_price,keywords) VALUES (?,?,?,?,?,?,?,?)", [T2, code, ar, en, cat, unit, price, kw]);
    for (const r of [["FO-01", "Fit-out", "Gypsum board ceiling incl. frame", "سقف جبس بورد مع الهيكل", "m2", 48, 32, 2, "gypsum,ceiling,جبس,سقف", "18"], ["FO-02", "Fit-out", "Porcelain tiles 60x60 laid", "بلاط بورسلان 60×60 تركيب", "m2", 92, 45, 3, "porcelain,tiles,flooring,بورسلان,بلاط", "14"], ["FO-03", "Fit-out", "Emulsion paint 3 coats", "دهان إيملشن 3 أوجه", "m2", 9, 12, 0, "paint,painting,دهان", "60"]]) run("INSERT INTO cost_db (tenant_id,code,trade,description,description_ar,unit,material,labor,equipment,keywords,productivity) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [T2, ...r]);

    // RFIs and incidents (history)
    const P = Object.fromEntries(projs1.map(x => [x.P.code, x.pid]));
    const RFIS = [
      ["P-2401", "Chilled water riser routing at level 9 conflicts with structural beam", "HVAC", "Level 9", -16, "open"], ["P-2401", "FCU model in schedule differs from approved submittal", "HVAC", "Typical floors", -11, "open"],
      ["P-2401", "Confirm sprinkler head type for car park (upright vs pendent)", "Fire fighting", "B1", -26, "answered"], ["P-2403", "DB-3F-02 location clashes with architectural niche", "Electrical", "Level 3", -9, "open"],
      ["P-2403", "Cable size for MDB feeder: 4x240 or 2x(4x120)?", "Electrical", "Basement", -20, "answered"], ["P-2402", "Smoke damper access panels — ceiling type to confirm", "HVAC", "Level 1", -4, "open"],
      ["P-2404", "Science lab gas detection — in scope?", "General", "Block B", -6, "open"], ["P-2404", "Drainage invert levels at external manholes", "Plumbing", "External", -15, "answered"],
    ];
    const cnt = {};
    for (const [code, subj, disc, loc, d, st] of RFIS) { cnt[code] = (cnt[code] || 0) + 1; const raised = addDays(now, d);
      run("INSERT INTO rfis (project_id,no,subject,question,location,discipline,status,raised_at,due_at,answered_at,answer) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [P[code], `RFI-${code}-${String(cnt[code]).padStart(3, "0")}`, subj, subj + ". Please advise.", loc, disc, st, stamp(raised), isoDay(addDays(raised, 7)), st === "answered" ? stamp(addDays(raised, between(3, 9))) : null, st === "answered" ? "Proceed as per consultant comment on the marked-up drawing." : null]); }
    for (const [code, kind, desc, sev, cause, days, d, st] of [
      ["P-2403", "delay", "DB shop drawings still awaiting consultant approval — DB installation on hold on levels 2–4.", "high", "consultant approval", 6, -12, "open"],
      ["P-2401", "delay", "Concrete works by the main contractor late on levels 10–12; no access for MEP first fix.", "medium", "other trades", 4, -25, "open"],
      ["P-2402", "safety", "Near miss: unsecured duct section slipped from scissor lift, no injury. Toolbox talk held.", "low", null, null, -18, "closed"],
      ["P-2404", "safety", "Worker without harness on mobile scaffold at Block A — stopped and briefed.", "medium", null, null, -5, "open"],
    ]) run("INSERT INTO incidents (project_id,kind,description,severity,cause,delay_days,at,status) VALUES (?,?,?,?,?,?,?,?)", [P[code], kind, desc, sev, cause, days, stamp(addDays(now, d), 11), st]);
  });

  // ---------- procurement history (run through the real agent functions)
  const t1 = 1; const P = Object.fromEntries(dbx.all("SELECT id, code FROM projects WHERE tenant_id=1").map(p => [p.code, p.id]));
  const cat = code => dbx.get("SELECT * FROM catalog WHERE tenant_id=1 AND code=?", [code]);
  const mkMr = (code, items, daysAgo, needIn, by) => {
    const created = addDays(now, -daysAgo); const n = dbx.get("SELECT COUNT(*) n FROM material_requests WHERE tenant_id=1").n + 1;
    const id = dbx.run("INSERT INTO material_requests (tenant_id,project_id,no,requested_by,needed_by,status,created_at) VALUES (?,?,?,?,?,?,?)", [t1, P[code], `MR-${String(n).padStart(3, "0")}`, by, isoDay(addDays(created, needIn)), "new", stamp(created, 10)]).lastId;
    for (const [c, q] of items) { const x = cat(c); dbx.run("INSERT INTO mr_items (mr_id,catalog_id,description,qty,unit) VALUES (?,?,?,?,?)", [id, x.id, x.name_en, q, x.unit]); }
    sendRfq(dbx, t1, id, created, "en"); return id;
  };
  const best = id => dbx.get("SELECT id FROM quotes WHERE mr_id=? AND recommended=1", [id]).id;
  const deliver = (poId, daysAgo) => { const po = dbx.get("SELECT po.*, m.project_id FROM purchase_orders po JOIN material_requests m ON m.id=po.mr_id WHERE po.id=?", [poId]); dbx.run("UPDATE purchase_orders SET status='delivered', delivered_at=? WHERE id=?", [stamp(addDays(now, -daysAgo), 13), poId]); dbx.run("UPDATE material_requests SET status='delivered' WHERE id=?", [po.mr_id]); };
  let id = mkMr("P-2401", [["GI-SHT", 1400], ["DUCT-INS", 1400]], 40, 10, "Eng. Bilal Ahmed"); deliver(issuePo(dbx, t1, id, best(id), addDays(now, -39)).id, 31);
  id = mkMr("P-2402", [["FF-2", 600], ["SPK-P", 420]], 28, 7, "Eng. Karim Nabil"); deliver(issuePo(dbx, t1, id, best(id), addDays(now, -27)).id, 22);
  id = mkMr("P-2403", [["CBL-4X16", 2500], ["CT-300", 600]], 22, 7, "Eng. Yasser Adel"); deliver(issuePo(dbx, t1, id, best(id), addDays(now, -21)).id, 15);
  id = mkMr("P-2401", [["CHW-4", 480], ["GV-4", 16]], 16, 8, "Eng. Bilal Ahmed"); issuePo(dbx, t1, id, best(id), addDays(now, -15)); // late: expected date has passed, not delivered
  dbx.run("UPDATE purchase_orders SET expected_at=? WHERE mr_id=?", [isoDay(addDays(now, -3)), id]);
  id = mkMr("P-2404", [["FCU-2T", 60], ["CHW-2", 900]], 3, 12, "Eng. Fahad Al-Otaibi"); // quoted, big → needs owner approval when awarded by procurement
  { const q = dbx.get("SELECT q.*, s.name supplier FROM quotes q JOIN suppliers s ON s.id=q.supplier_id WHERE q.id=?", [best(id)]); const m = dbx.get("SELECT * FROM material_requests WHERE id=?", [id]);
    dbx.run("INSERT INTO approvals (tenant_id,kind,ref_id,title,amount,reason,approver_role,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [t1, "po", id, JSON.stringify({ quote_id: q.id, en: `PO for ${m.no} (P-2404) — ${q.supplier}`, ar: `أمر شراء ${m.no} (P-2404) — ${q.supplier}` }), q.total, null, "owner", "pending", stamp(addDays(now, -2), 15)]);
    dbx.run("UPDATE material_requests SET status='pending_approval' WHERE id=?", [id]); }
  mkMr("P-2403", [["LED-6060", 450], ["LED-DL", 300], ["CBL-3X2.5", 3000]], 1, 9, "Eng. Yasser Adel"); // quoted, waiting for award

  // ---------- field messages from site (processed by the field agent)
  const user = k => dbx.get("SELECT u.id, u.name, u.phone, p.id project_id FROM users u LEFT JOIN projects p ON p.engineer_user_id=u.id WHERE u.email=?", [k]);
  const ago = hrs => new Date(now.getTime() - hrs * 3600e3);
  const msgs = [
    [user("karim@watad.example"), "Today at Noor clinic: installed 85 m fire fighting pipe and 40 sprinklers on level 2. Manpower 9 fitters and 4 helpers.", ago(40)],
    [user("bilal@watad.example"), "صباح الخير، اليوم في برج الياسمين خلصنا 180 م2 دكت في الدور 7 و 12 فان كويل. العمالة 14 دكت و 6 مساعدين", ago(17)],
    [user("yasser@watad.example"), "المخطط الكهربائي للدور 3 فيه تعارض بين مسار الكيبل تري والدكت، نمشي على أي مسار؟", ago(15)],
    [user("bilal@watad.example"), "توقف العمل في مواسير التشلر بالدور 9 بسبب ما وصلت المواسير 4 انش من المورد، متأخرين يومين", ago(14)],
    [user("fahad@watad.example"), "نحتاج 300 متر كيبل 4x16 و 20 لوحة توزيع لمدرسة الملقا قبل يوم الأحد", ago(3)],
    [{ id: null, name: "Foreman Rashid (subcontractor)", phone: "+9665XX660001" }, "خلصنا تركيب 60 كشاف LED", ago(2.2)],
    [user("karim@watad.example"), "Near miss today: a ladder slipped at level 3, no injury. Toolbox talk done with the team.", ago(0.8)],
  ];
  for (const [s, text, when] of msgs) processFieldMessage(dbx, { tenant_id: t1, sender: s, text, at: when });

  // ---------- estimates (built by the estimation agent)
  const costDb = dbx.all("SELECT * FROM cost_db WHERE tenant_id=1");
  const TENDERS = [
    ["Rawdah Villas Compound (24 villas) — MEP package", "Rawdah Homes Development", "submitted", `1. Supply & install split units 2TR — 96 no
2. PPR water supply pipe 32mm — 3,800 m
3. UPVC drainage pipe 110mm — 2,600 m
4. Wall-hung WC complete — 120 no
5. Wash basin with mixer — 120 no
6. Water heater 80L — 48 no
7. Lighting circuit wiring 3x2.5 in conduit — 14,000 m
8. LED downlights 12W — 1,900 no
9. Sockets and switches — 2,300 no
10. Distribution board 24 way — 24 no
11. Testing and commissioning — 1 ls`],
    ["King Fahd Road Office Floor 12 — HVAC & electrical", "Tamkeen Real Estate", "won", `A1	GI ductwork incl. supports	m2	1450
A2	Duct insulation 25mm	m2	1450
A3	Fan coil units 2TR	no	38
A4	Chilled water pipe 2" insulated	m	620
B1	Cable 4x16 in tray	m	1800
B2	Cable tray 300mm	m	420
B3	LED panel 60x60	no	520
B4	Smart lighting control system	ls	1
B5	Distribution board 24-way	no	8`],
  ];
  TENDERS.forEach(([title, client, status, text], i) => {
    const e = buildEstimate(text, costDb, { overhead_pct: 10, margin_pct: i ? 11 : 13, lang: "en" });
    dbx.run("INSERT INTO estimates (tenant_id,no,client,title,tender_text,lines,overhead_pct,risk_pct,margin_pct,totals,status,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [t1, `EST-${now.getFullYear()}-${String(i + 1).padStart(3, "0")}`, client, title, text, JSON.stringify(e.lines), e.overhead_pct, e.risk_pct, e.margin_pct, JSON.stringify(e.totals), status, stamp(addDays(now, -(20 - i * 12)), 14), 4]);
  });
  dbx.run("INSERT INTO audit_log (tenant_id,at,actor,action,entity,detail) VALUES (1,?,?,?,?,?)", [stamp(now, 7, 0), "system", "seed", "sample_data", JSON.stringify({ note: "fictional demo data" })]);
}
