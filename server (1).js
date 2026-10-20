// LINE bot คำนวณเวร — ไม่ต้อง npm install (ใช้ Node 18+)
const http = require("http"), crypto = require("crypto"), fs = require("fs");
const SECRET = process.env.LINE_CHANNEL_SECRET, TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const FILE = process.env.DATA_FILE || "./data.json", PORT = process.env.PORT || 3000;
const MN = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const T0 = () => [["m","เวรเช้า","ช",800,"s"],["a","เวรบ่าย","บ",900,"s"],["n","เวรดึก","ด",1000,"s"],
  ["om","OT เช้า","OT",700,"o"],["oa","OT บ่าย","OT",900,"o"],["on","OT ดึก","OT",800,"o"],["x","OFF","OFF",0,"x"]]
  .map(([id,name,short,rate,kind]) => ({id,name,short,rate,kind}));
// เก็บข้อมูล: ถ้าตั้ง SUPABASE_URL + SUPABASE_KEY จะเก็บใน Supabase (ไม่หายตอน Render รีสตาร์ท) ไม่งั้นเก็บในไฟล์
const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, ""), SB_KEY = process.env.SUPABASE_KEY, useSB = !!(SB_URL && SB_KEY);
let DB = {}; if (!useSB) { try { DB = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {} }
const snap = {}; let chain = Promise.resolve();
async function sb(path, opts = {}) {
  const headers = { apikey: SB_KEY, "Content-Type": "application/json", ...(opts.headers || {}) };
  if (SB_KEY.startsWith("eyJ")) headers.Authorization = "Bearer " + SB_KEY;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opts, headers });
  if (!r.ok) throw new Error(`supabase ${r.status} ${await r.text()}`);
  return r;
}
async function loadDB() {
  if (!useSB) return;
  (await (await sb("bot_data?select=id,data")).json()).forEach(r => { DB[r.id] = r.data; snap[r.id] = JSON.stringify(r.data); });
  console.log("โหลดข้อมูลจาก Supabase " + Object.keys(DB).length + " บัญชี");
}
const save = () => {
  if (!useSB) { try { fs.writeFileSync(FILE, JSON.stringify(DB)); } catch (e) { console.error(e); } return; }
  Object.keys(DB).forEach(id => {
    const s = JSON.stringify(DB[id]); if (snap[id] === s) return; snap[id] = s;
    chain = chain.then(() => sb("bot_data?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id, data: JSON.parse(s) }) }))
      .catch(e => { console.error("บันทึกไม่สำเร็จ จะลองใหม่ครั้งหน้า", e.message); delete snap[id]; });
  });
};
const user = id => DB[id] || (DB[id] = { types: T0(), other: [], days: {} });
const tok = u => u.token || (u.token = crypto.randomBytes(16).toString("hex"));
const byTok = t => Object.values(DB).find(u => u.token && u.token === t);
const COL = { m: "#f5b83d", a: "#ee8a4b", n: "#3b2fd8" };
const color = t => t.color || COL[t.id] || (t.kind === "o" ? "#17a589" : t.kind === "x" ? "#9a97b3" : "#e0457b");
const fmt = n => Math.round(n).toLocaleString("th-TH");
const pad = n => String(n).padStart(2, "0");
const alias = t => t.name.replace(/^เวร/, "") || t.name;
const bkk = now => { const d = new Date(now.getTime() + 7 * 36e5); return { Y: d.getUTCFullYear(), M: d.getUTCMonth(), D: d.getUTCDate() }; };
const key = (Y, M, d) => `${Y}-${pad(M + 1)}-${pad(d)}`;
const dim = (Y, M) => new Date(Y, M + 1, 0).getDate();
const find = (u, n) => { n = n.toLowerCase(); return u.types.find(t => [t.name, alias(t), t.short].some(x => x.toLowerCase() === n)); };

function calc(u, Y, M) {
  const r = { ns: 0, no: 0, nx: 0, ms: 0, mo: 0 };
  for (let d = 1; d <= dim(Y, M); d++) (u.days[key(Y, M, d)] || []).forEach(id => {
    const t = u.types.find(x => x.id === id); if (!t) return;
    if (t.kind === "x") r.nx++; else if (t.kind === "o") { r.no++; r.mo += t.rate; } else { r.ns++; r.ms += t.rate; }
  });
  r.oth = u.other.reduce((s, o) => s + o.amt, 0); r.total = r.ms + r.mo + r.oth; return r;
}
function monthData(u, Y, M) {
  const days = {}; for (let d = 1; d <= dim(Y, M); d++) { const a = u.days[key(Y, M, d)]; if (a && a.length) days[d] = a; }
  return { Y, M, days, other: u.other, sum: calc(u, Y, M), types: u.types.map(t => ({ id: t.id, name: t.name, short: t.short, kind: t.kind, rate: t.rate, color: color(t) })) };
}
function parseDays(u, text, Y, M) {
  const names = []; u.types.forEach(t => [t.name, alias(t)].forEach(n => names.push([n.toLowerCase(), t.id])));
  names.sort((a, b) => b[0].length - a[0].length);
  const out = {};
  text.split("\n").forEach(line => {
    const m = line.trim().match(/^(?:วันที่\s*)?(\d{1,2})\s*[:.\-]?\s*(.+)$/); if (!m) return;
    const d = +m[1]; if (d < 1 || d > dim(Y, M)) return;
    let rest = m[2].toLowerCase(), ids = [];
    names.forEach(([n, id]) => { if (rest.includes(n)) { ids.push(id); rest = rest.split(n).join(" "); } });
    rest.split(/[\s,/+]+/).filter(Boolean).forEach(w => { const t = u.types.find(t => t.short.toLowerCase() === w); if (t) ids.push(t.id); });
    ids = [...new Set(ids)];
    if (ids.some(id => u.types.find(t => t.id === id).kind === "x")) ids = ids.filter(id => u.types.find(t => t.id === id).kind === "x").slice(0, 1);
    if (ids.length) out[d] = ids;
  });
  return out;
}
// ===== ค่าใช้จ่าย (ปฏิทินค่าใช้จ่าย) =====
const asking = new Map(); // id -> { t: เวลา, kind: "cal" | "sum", mo } ที่บอทถามว่าจะเลือกเวรหรือค่าใช้จ่าย (ไม่เก็บลงไฟล์)
const ASKSUM = "จะสรุปอะไร?\n1. สรุปเวร\n2. สรุปค่าใช้จ่าย\n\nพิมพ์ 1 หรือ 2 (หรือพิมพ์ เวร / ค่าใช้จ่าย)";
function shiftSummary(u, Y, mo) {
  const c = calc(u, Y, mo);
  return `สรุป ${MN[mo]} ${Y + 543}\nเวรปกติ ${c.ns} เวร: ${fmt(c.ms)}\nOT ${c.no} เวร: ${fmt(c.mo)}\nรายได้อื่น: ${fmt(c.oth)}\nวันหยุด ${c.nx} วัน\nรวม ${fmt(c.total)} บาท`;
}
const ASK = "จะใช้ปฏิทินอะไร?\n1. ปฏิทินเวร\n2. ปฏิทินค่าใช้จ่าย\n\nพิมพ์ 1 หรือ 2 (หรือพิมพ์ชื่อปฏิทินก็ได้)";
const C0 = () => [["b","อาหารเช้า","#f5b83d"],["l","อาหารกลางวัน","#ee8a4b"],["d","อาหารเย็น","#3b2fd8"],["k","เครื่องดื่ม","#17a589"],["s","ของว่าง","#e0457b"]].map(([id,name,color]) => ({id,name,color}));
const ex = u => {
  const e = u.exp || (u.exp = { cats: C0(), items: {}, none: {}, budget: 0, v: 2 });
  if (!e.v) { // ย้ายจากชุดหมวดรุ่นแรก (อาหาร/เดินทาง/ของใช้/ที่พัก/อื่นๆ) มาเป็นประเภทอาหาร
    if (e.cats.length === 5 && ["f","t","g","h","o"].every((id, i) => e.cats[i].id === id)) {
      e.cats = C0(); Object.keys(e.items).forEach(k => e.items[k].forEach(x => { x.c = x.c === "f" ? "l" : ""; }));
    }
    e.v = 2;
  }
  if (!e.none) e.none = {}; // วันที่ระบุว่า "ไม่มีค่าใช้จ่าย" (ยอด 0)
  return e;
};
const NOCAT = { id: "", name: "ไม่มีหมวด", color: "#9a97b3" };
const catOf = (e, id) => e.cats.find(c => c.id === id) || NOCAT;
const findCat = (e, n) => { n = n.toLowerCase(); return e.cats.find(c => { const x = c.name.toLowerCase(); return x === n || x.replace(/^อาหาร/, "") === n; }); }; // พิมพ์ "เช้า" ได้เท่ากับ "อาหารเช้า"
const r2 = n => Math.round(n * 100) / 100;
const fmtx = n => (+n).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const PAL = ["#e0457b","#17a589","#f5b83d","#3b2fd8","#ee8a4b","#8e44ad","#2e86c1","#7f8c8d"];
function calReply(u, base, kind) {
  const l = tok(u); save();
  return (kind === "exp" ? "ปฏิทินค่าใช้จ่ายของคุณ\n" : "ปฏิทินเวรของคุณ\n") + `${base}/c/${l}${kind === "exp" ? "?v=exp" : ""}\n(ลิงก์ส่วนตัว ใครมีลิงก์ก็ดูและแก้ได้ อย่าแชร์)`;
}
function addCat(e, name, color) {
  name = String(name || "").trim().slice(0, 20); if (!name) return { err: "ต้องใส่ชื่อหมวด" };
  if (findCat(e, name)) return { err: "มีหมวดนี้แล้ว" };
  if (e.cats.length >= 30) return { err: "มีหมวดได้สูงสุด 30 หมวด" };
  const c = { id: "c" + newId(), name, color: /^#[0-9a-f]{6}$/i.test(color) ? color : PAL[e.cats.length % PAL.length] };
  e.cats.push(c); return { ok: c };
}
function addExp(e, k, cat, amt, note) {
  amt = Math.min(1e8, r2(+amt)); if (!(amt > 0)) return { err: "ต้องใส่จำนวนเงินมากกว่า 0" };
  const list = e.items[k] || (e.items[k] = []);
  if (list.length >= 100) return { err: "วันนี้มีรายการเยอะเกินไป (สูงสุด 100)" };
  list.push({ i: newId(), c: cat, a: amt, n: String(note || "").trim().slice(0, 40) });
  delete e.none[k]; // วันที่มีรายการจ่ายแล้ว ไม่ใช่ "ไม่มีค่าใช้จ่าย" อีกต่อไป
  return { ok: true };
}
function expMonth(e, Y, M) {
  const by = {}, days = {}, menus = {}, none = []; let total = 0, n = 0;
  for (let d = 1; d <= dim(Y, M); d++) {
    const l = e.items[key(Y, M, d)]; if (!l || !l.length) { if (e.none[key(Y, M, d)]) none.push(d); continue; }
    days[d] = l; l.forEach(x => { by[x.c] = (by[x.c] || 0) + x.a; const mm = menus[x.c] || (menus[x.c] = {}), nm = (x.n || "").trim(); mm[nm] = r2((mm[nm] || 0) + x.a); total += x.a; n++; });
  }
  return { days, by, menus, none, total: r2(total), n };
}
function expData(u, Y, M) {
  const e = ex(u), m = expMonth(e, Y, M);
  return { Y, M, days: m.days, none: m.none, cats: e.cats, budget: e.budget || 0, sum: { total: m.total, n: m.n, by: m.by, menus: m.menus } };
}
function expBreakdown(e, by, menus) {
  const L = Object.keys(by).map(id => [id, catOf(e, id).name, by[id]]).sort((a, b) => b[2] - a[2]);
  const menuLines = id => { const ms = Object.entries(menus[id] || {}).sort((a, b) => b[1] - a[1]); return ms.slice(0, 8).map(([n, v]) => `   • ${n || "ไม่ระบุเมนู"} ${fmtx(v)}`).concat(ms.length > 8 ? [`   …อีก ${ms.length - 8} เมนู`] : []); };
  return L.map(([id, n, v]) => [`${n}: ${fmtx(v)}`, ...menuLines(id)].join("\n")).join("\n");
}
const noneLine = m => m.none.length ? `\nไม่มีค่าใช้จ่าย ${m.none.length} วัน (วันที่ ${m.none.join(", ")})` : "";
function expSummary(u, Y, M) {
  const e = ex(u), m = expMonth(e, Y, M);
  if (!m.n && !m.none.length) return `ยังไม่มีค่าใช้จ่าย ${MN[M]} ${Y + 543}\nพิมพ์ เช่น จ่าย กลางวัน 60 ข้าวมันไก่`;
  return `ค่าใช้จ่าย ${MN[M]} ${Y + 543}\n` + (m.n ? expBreakdown(e, m.by, m.menus) + "\n" : "") + `รวม ${fmtx(m.total)} บาท` + (m.n ? ` (${m.n} รายการ)` : "") + noneLine(m)
    + (e.budget ? `\nงบ ${fmtx(e.budget)} · ` + (m.total <= e.budget ? `เหลือ ${fmtx(e.budget - m.total)}` : `เกินงบ ${fmtx(m.total - e.budget)}`) : "");
}
// รายการจ่ายรายวัน: ทั้งเดือน / วันเดียว / หลายวัน / ช่วงวัน แล้วสรุปรวมให้
const BADDAY = "รูปแบบวันที่ไม่ถูกต้อง ตัวอย่าง: รายการจ่าย 16 / รายการจ่าย 16 18 20 / รายการจ่าย 16-20 / รายการจ่าย 16/11 / รายการจ่าย เดือน 9";
function expRange(u, now, args) {
  const e = ex(u), { Y, M } = bkk(now); let keys = [], head, m; args = (args || "").trim();
  const whole = mo => { const k = []; for (let d = 1; d <= dim(Y, mo); d++) k.push(key(Y, mo, d)); return k; };
  if (!args) { keys = whole(M); head = `${MN[M]} ${Y + 543} (ทั้งเดือน)`; }
  else if ((m = args.match(/^เดือน\s*(\d{1,2})$/))) { const mo = +m[1] - 1; if (mo < 0 || mo > 11) return "เดือนต้องเป็น 1–12"; keys = whole(mo); head = `${MN[mo]} ${Y + 543} (ทั้งเดือน)`; }
  else {
    const set = new Set();
    for (const tk of args.split(/[\s,]+/).filter(Boolean)) {
      const x = tk.match(/^(\d{1,2})(?:-(\d{1,2}))?(?:\/(\d{1,2}))?$/); if (!x) return BADDAY;
      const mo = x[3] ? +x[3] - 1 : M, a = +x[1], b = x[2] ? +x[2] : a;
      if (mo < 0 || mo > 11 || a < 1 || b < a || b > dim(Y, mo)) return BADDAY;
      for (let d = a; d <= b; d++) set.add(key(Y, mo, d));
    }
    keys = [...set].sort(); head = `เลือก ${keys.length} วัน`;
  }
  const by = {}, menus = {}, rows = []; let total = 0, n = 0;
  keys.forEach(k => {
    const l = e.items[k]; if (!l || !l.length) { if (e.none[k]) rows.push(`${fd(k)} — 0 บาท (ไม่มีค่าใช้จ่าย)`); return; } let dt = 0;
    l.forEach(x => { by[x.c] = (by[x.c] || 0) + x.a; const mm = menus[x.c] || (menus[x.c] = {}), nm = (x.n || "").trim(); mm[nm] = r2((mm[nm] || 0) + x.a); dt += x.a; total += x.a; n++; });
    rows.push(`${fd(k)} — ${fmtx(dt)} บาท\n` + l.map((x, i) => ` ${i + 1}. ${catOf(e, x.c).name}${x.n ? " " + x.n : ""} ${fmtx(x.a)}`).join("\n"));
  });
  if (!rows.length) return `รายการจ่าย ${head}\nไม่มีรายการในช่วงนี้ พิมพ์ เช่น จ่าย กลางวัน 60 ข้าวมันไก่`;
  return `รายการจ่าย ${head}\nรวม ${fmtx(total)} บาท (${n} รายการ ใน ${rows.length} วัน · เฉลี่ย ${fmtx(total / rows.length)}/วัน)` + (args && keys.length > rows.length ? `\n(ไม่มีรายการ ${keys.length - rows.length} วัน)` : "")
    + "\n\n" + rows.join("\n");
}
function expAdd(u, text, now) {
  const e = ex(u), { Y, M, D: today } = bkk(now), ok = [], bad = [], made = [];
  text.split("\n").forEach(raw => {
    const line = raw.trim().replace(/^จ่าย\s+/, ""); if (!line) return;
    const m = line.match(/^(?:(\d{1,2}(?:\/\d{1,2})?)\s+)?(\S+)\s+(\d[\d,]*(?:\.\d{1,2})?)(?:\s+(.+))?$/);
    if (!m) { bad.push(`${line} (รูปแบบไม่ถูกต้อง)`); return; }
    const k = m[1] ? dkey(m[1], now) : key(Y, M, today); if (!k) { bad.push(`${line} (วันที่ไม่ถูกต้อง)`); return; }
    if (!(r2(+m[3].replace(/,/g, "")) > 0)) { bad.push(`${line} (ต้องใส่จำนวนเงินมากกว่า 0)`); return; }
    let c = findCat(e, m[2]);
    if (!c) { const r = addCat(e, m[2]); if (r.err) { bad.push(`${line} (${r.err})`); return; } c = r.ok; made.push(c.name); }
    const amt = +m[3].replace(/,/g, ""), note = (m[4] || "").trim().slice(0, 40), r = addExp(e, k, c.id, amt, note);
    if (r.err) { bad.push(`${line} (${r.err})`); return; }
    ok.push(`${fd(k)} ${c.name}${note ? " " + note : ""} ${fmtx(amt)}`);
  });
  save();
  if (!ok.length) return "บันทึกไม่ได้\n" + bad.join("\n") + "\n\nตัวอย่าง: จ่าย กลางวัน 60 ข้าวมันไก่ หรือ จ่าย 16 เช้า 40 ไข่กระทะ";
  const mm = expMonth(e, Y, M);
  return `บันทึกค่าใช้จ่าย ${ok.length} รายการ\n` + ok.join("\n") + (made.length ? `\n(สร้างประเภทใหม่: ${made.join(", ")})` : "")
    + (bad.length ? "\n\nบันทึกไม่ได้:\n" + bad.join("\n") : "") + `\n\nรวม${MN[M]} ${fmtx(mm.total)} บาท` + (e.budget ? ` (งบ${mm.total <= e.budget ? "เหลือ " + fmtx(e.budget - mm.total) : "เกิน " + fmtx(mm.total - e.budget)})` : "");
}
// บอกว่าวันไหนไม่มีค่าใช้จ่าย (ยอด 0): ไม่จ่าย / ไม่จ่าย 16 / ไม่จ่าย 16 18 / ไม่จ่าย 16-20 / ไม่จ่าย 16/11
const BADNONE = "รูปแบบวันที่ไม่ถูกต้อง ตัวอย่าง: ไม่จ่าย (วันนี้) / ไม่จ่าย 16 / ไม่จ่าย 16 18 20 / ไม่จ่าย 16-20 / ไม่จ่าย 16/11";
function expNone(u, now, args) {
  const e = ex(u), { Y, M, D } = bkk(now), keys = new Set(); args = (args || "").trim();
  if (!args) keys.add(key(Y, M, D));
  else for (const tk of args.split(/[\s,]+/).filter(Boolean)) {
    const x = tk.match(/^(\d{1,2})(?:-(\d{1,2}))?(?:\/(\d{1,2}))?$/); if (!x) return BADNONE;
    const mo = x[3] ? +x[3] - 1 : M, a = +x[1], b = x[2] ? +x[2] : a;
    if (mo < 0 || mo > 11 || a < 1 || b < a || b > dim(Y, mo)) return BADNONE;
    for (let d = a; d <= b; d++) keys.add(key(Y, mo, d));
  }
  if (keys.size > 62) return "เลือกได้สูงสุด 62 วันต่อครั้ง";
  const ok = [], skip = [];
  [...keys].sort().forEach(k => {
    const l = e.items[k] || [];
    if (l.length) skip.push(`${fd(k)} (มี ${l.length} รายการ รวม ${fmtx(l.reduce((s, x) => s + x.a, 0))} บาท)`); else { e.none[k] = 1; ok.push(fd(k)); }
  });
  save();
  let out = ok.length ? `บันทึกว่าไม่มีค่าใช้จ่าย ${ok.length} วัน (ยอด 0 บาท)\n${ok.join(", ")}` : "บันทึกไม่ได้";
  if (skip.length) out += `\n\nข้ามเพราะมีรายการจ่ายอยู่แล้ว:\n${skip.join("\n")}\nถ้าจะตั้งเป็นไม่มีค่าใช้จ่าย ให้ลบจ่ายของวันนั้นก่อน (เช่น ลบจ่าย 16)`;
  if (ok.length) out += `\n\nรวม${MN[M]} ${fmtx(expMonth(e, Y, M).total)} บาท`;
  return out;
}
function expCmd(u, text, now) {
  const t = text.trim(), { Y, M } = bkk(now); let m;
  if ((m = t.match(/^จ่าย\s+([\s\S]+)$/))) return expAdd(u, m[1], now);
  if ((m = t.match(/^(?:สรุปจ่าย|สรุปค่าใช้จ่าย|ค่าใช้จ่าย)\s*(\d{1,2})?$/))) { const mo = m[1] ? +m[1] - 1 : M; return mo < 0 || mo > 11 ? "เดือนต้องเป็น 1–12" : expSummary(u, Y, mo); }
  if ((m = t.match(/^(?:รายการจ่าย|สรุปวัน)(?:\s+(.+))?$/))) return expRange(u, now, m[1]);
  if ((m = t.match(/^(?:ไม่มีค่าใช้จ่าย|ไม่จ่าย)(?:\s+(.+))?$/))) return expNone(u, now, m[1]);
  if ((m = t.match(/^ลบจ่าย\s+(\d{1,2}(?:\/\d{1,2})?)(?:\s+(\d+))?$/))) {
    const e = ex(u), k = dkey(m[1], now); if (!k) return "วันที่ไม่ถูกต้อง";
    const l = e.items[k] || [];
    if (!l.length) { if (e.none[k]) { delete e.none[k]; save(); return `ยกเลิกสถานะ "ไม่มีค่าใช้จ่าย" ของวันที่ ${fd(k)} แล้ว`; } return `วันที่ ${fd(k)} ไม่มีรายการจ่าย`; }
    if (m[2]) {
      const i = +m[2] - 1; if (!l[i]) return `ไม่พบรายการที่ ${m[2]} ของวันที่ ${fd(k)} (มี ${l.length} รายการ)`;
      const x = l.splice(i, 1)[0]; if (!l.length) delete e.items[k]; save(); return `ลบ ${catOf(e, x.c).name} ${fmtx(x.a)} ของวันที่ ${fd(k)} แล้ว`;
    }
    delete e.items[k]; save(); return `ล้างรายการจ่ายวันที่ ${fd(k)} แล้ว (${l.length} รายการ)`;
  }
  if (/^(หมวด|ประเภท)$/.test(t)) return "ประเภทที่มี\n" + ex(u).cats.map(c => c.name).join(", ") + "\n\nเพิ่ม: เพิ่มหมวด ชานม / ลบ: ลบหมวด ชานม";
  if ((m = t.match(/^เพิ่ม(?:หมวด|ประเภท)\s+(.+)$/))) { const r = addCat(ex(u), m[1]); if (r.err) return r.err; save(); return `เพิ่มประเภท "${r.ok.name}" แล้ว`; }
  if ((m = t.match(/^ลบ(?:หมวด|ประเภท)\s+(.+)$/))) {
    const e = ex(u), c = findCat(e, m[1].trim()); if (!c) return `ไม่พบประเภท "${m[1].trim()}"`;
    e.cats = e.cats.filter(x => x !== c); save(); return `ลบประเภท ${c.name} แล้ว (รายการเดิมจะกลายเป็น "ไม่มีหมวด")`;
  }
  if ((m = t.match(/^งบ(?:\s+([\d,]+))?$/))) {
    const e = ex(u); if (m[1] === undefined) return e.budget ? `งบต่อเดือน ${fmtx(e.budget)} บาท` : "ยังไม่ได้ตั้งงบ พิมพ์ เช่น งบ 15000";
    e.budget = Math.min(1e8, +m[1].replace(/,/g, "")); save(); return e.budget ? `ตั้งงบต่อเดือน ${fmtx(e.budget)} บาท แล้ว` : "ยกเลิกงบแล้ว";
  }
  return null;
}
// ===== ทีม / ดูตารางกัน / แลกเวร =====
const outbox = [];
const flush = () => outbox.splice(0).forEach(m => push(m.to, m.text));
const idOf = u => Object.keys(DB).find(k => DB[k] === u);
const tm = u => u.team && DB["team:" + u.team];
const NOTEAM = "ยังไม่ได้อยู่ในทีม พิมพ์ สร้างทีม ชื่อทีม หรือ เข้าทีม รหัส";
const ofMember = (m, k) => (m.days[k] || []).map(i => m.types.find(x => x.id === i)).filter(Boolean);
const shiftsOn = (m, k) => ofMember(m, k).filter(x => x.kind !== "x");
const label = (m, k) => shiftsOn(m, k).map(alias).join("+");
const fd = k => { const [, mo, d] = k.split("-"); return `${+d} ${MN[+mo - 1]}`; };
function dkey(s, now) {
  const m = String(s).match(/^(\d{1,2})(?:\/(\d{1,2}))?$/); if (!m) return null;
  const { Y, M } = bkk(now), mo = m[2] ? +m[2] - 1 : M, d = +m[1];
  return mo < 0 || mo > 11 || d < 1 || d > dim(Y, mo) ? null : key(Y, mo, d);
}
function uniq(t, name, selfId) {
  const base = name.trim().slice(0, 20) || "สมาชิก"; let n = base, i = 2;
  const taken = x => t.members.some(id => id !== selfId && DB[id] && (DB[id].name || "").toLowerCase() === x.toLowerCase());
  while (taken(n)) n = base + " " + i++;
  return n;
}
function member(t, q, selfId) {
  q = q.trim().toLowerCase(); const ms = t.members.filter(id => id !== selfId && DB[id]), nm = id => (DB[id].name || "").toLowerCase();
  const ex = ms.filter(id => nm(id) === q); if (ex.length === 1) return ex[0];
  const st = ms.filter(id => nm(id).startsWith(q)); return st.length === 1 ? st[0] : null;
}
function mapType(t, to) {
  let x = to.types.find(y => y.name === t.name) || to.types.find(y => y.short === t.short && y.kind === t.kind);
  if (!x) { x = { id: "c" + Date.now() + Math.random().toString(36).slice(2, 5), name: t.name, short: t.short, rate: 0, kind: t.kind, color: t.color }; to.types.push(x); }
  return x.id;
}
const put = (to, k, shifts) => {
  const ids = (to.days[k] || []).filter(i => { const x = to.types.find(t => t.id === i); return x && x.kind !== "x"; });
  shifts.forEach(t => { const id = mapType(t, to); if (!ids.includes(id)) ids.push(id); }); to.days[k] = ids;
};
function createTeam(u, id, name) {
  if (u.team) return { err: "คุณอยู่ในทีมแล้ว พิมพ์ ออกทีม ก่อนถ้าจะสร้างใหม่" };
  name = name.trim().slice(0, 30); if (!name) return { err: "ต้องใส่ชื่อทีม" };
  let code; do code = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase(); while (DB["team:" + code]);
  const t = DB["team:" + code] = { name, owner: id, members: [id], swaps: [], seq: 0 };
  u.team = code; u.name = uniq(t, u.name || "สมาชิก 1", id); save();
  return { ok: `สร้างทีม "${name}" แล้ว\nรหัสทีม: ${code}\n\nส่งข้อความนี้เข้ากลุ่ม LINE ให้เพื่อนได้เลย:\nเข้าทีมเวร "${name}" แอดบอทแล้วพิมพ์ในแชทบอท: เข้าทีม ${code}${process.env.LINE_ADD_URL ? "\nแอดบอท: " + process.env.LINE_ADD_URL : ""}\n\nตั้งชื่อที่เพื่อนจะเห็น: ชื่อ ฝน` };
}
function joinTeam(u, id, code) {
  code = code.trim().toUpperCase(); const t = DB["team:" + code];
  if (u.team === code) return { err: "คุณอยู่ในทีมนี้แล้ว" };
  if (u.team) return { err: "คุณอยู่ในทีมอื่นอยู่ พิมพ์ ออกทีม ก่อน" };
  if (!t) return { err: "ไม่พบรหัสทีมนี้ ตรวจรหัสอีกครั้ง" };
  if (t.members.length >= 30) return { err: "ทีมเต็มแล้ว (สูงสุด 30 คน)" };
  t.members.push(id); u.team = code; u.name = uniq(t, u.name || `สมาชิก ${t.members.length}`, id); save();
  return { ok: `เข้าทีม "${t.name}" แล้ว (${t.members.length} คน) ชื่อของคุณในทีมคือ "${u.name}" เปลี่ยนได้ด้วย: ชื่อ ฝน\nพิมพ์ ตารางทีม เพื่อดูเวรของทุกคน` };
}
function leaveTeam(u, id) {
  const t = tm(u); if (!t) return { err: NOTEAM };
  t.swaps.filter(s => s.status === "pending" && (s.from === id || s.to === id)).forEach(s => {
    s.status = "cancelled"; const o = s.from === id ? s.to : s.from;
    outbox.push({ to: o, text: `คำขอ #${s.id} ถูกยกเลิก เพราะ ${u.name} ออกจากทีมแล้ว` });
  });
  t.members = t.members.filter(x => x !== id); if (t.owner === id && t.members.length) t.owner = t.members[0];
  const nm = t.name; u.team = null; save(); return { ok: `ออกจากทีม "${nm}" แล้ว` };
}
function rename(u, id, name) {
  name = name.trim().slice(0, 20); if (!name) return { err: "ต้องใส่ชื่อ" };
  const t = tm(u); u.name = t ? uniq(t, name, id) : name; save(); return { ok: `ตั้งชื่อเป็น "${u.name}" แล้ว` };
}
const describe = s => { const A = DB[s.from], B = DB[s.to]; return s.kind === "swap" ? `#${s.id} ${A.name} (${fd(s.a)} ${s.la}) ⇄ ${B.name} (${fd(s.b)} ${s.lb})` : `#${s.id} ${A.name} ฝากเวร ${fd(s.a)} (${s.la}) ให้ ${B.name}`; };
function newSwap(u, id, kind, aStr, name, bStr, now) {
  const t = tm(u); if (!t) return { err: NOTEAM };
  const to = member(t, name, id); if (!to) return { err: `ไม่พบสมาชิก "${name}" ในทีม (พิมพ์ ทีม เพื่อดูรายชื่อ)` };
  const B = DB[to], a = dkey(aStr, now), b = kind === "swap" ? dkey(bStr, now) : null;
  if (!a || (kind === "swap" && !b)) return { err: "วันที่ไม่ถูกต้อง" };
  if (!shiftsOn(u, a).length) return { err: `คุณไม่มีเวรวันที่ ${fd(a)} (ลงเวรก่อนแล้วค่อยขอแลก)` };
  if (kind === "swap" && !shiftsOn(B, b).length) return { err: `${B.name} ไม่มีเวรวันที่ ${fd(b)}` };
  if (t.swaps.some(s => s.status === "pending" && s.from === id && s.to === to && s.a === a)) return { err: "มีคำขอนี้รออยู่แล้ว" };
  const s = { id: ++t.seq, kind, from: id, to, a, b, la: label(u, a), lb: b ? label(B, b) : "", status: "pending", at: Date.now() };
  t.swaps.push(s); if (t.swaps.length > 200) t.swaps = t.swaps.slice(-200);
  const warn = shiftsOn(B, a).length ? `\n⚠ ${fd(a)} คุณมีเวรอยู่แล้ว ถ้ารับจะซ้อนเวร` : "";
  outbox.push({ to, text: `📩 ${u.name} ขอ${kind === "swap" ? "แลกเวร" : "ฝากเวร"}\n${describe(s)}${warn}\nพิมพ์ รับ ${s.id} หรือ ปฏิเสธ ${s.id}` });
  save(); return { ok: `ส่งคำขอถึง ${B.name} แล้ว\n${describe(s)}\nรอ ${B.name} พิมพ์ รับ ${s.id} (ถ้าไม่เห็นแจ้งเตือน ให้ ${B.name} พิมพ์ คำขอ)` };
}
function answer(u, id, sid, op) {
  const t = tm(u); if (!t) return { err: NOTEAM };
  const s = t.swaps.find(x => x.id === +sid); if (!s) return { err: `ไม่พบคำขอ #${sid}` };
  if (s.status !== "pending") return { err: `คำขอ #${sid} ปิดไปแล้ว (${{ accepted: "รับแล้ว", rejected: "ปฏิเสธแล้ว", cancelled: "ยกเลิกแล้ว", invalid: "ใช้ไม่ได้แล้ว" }[s.status]})` };
  const A = DB[s.from], B = DB[s.to];
  if (op === "cancel") {
    if (s.from !== id) return { err: "ยกเลิกได้เฉพาะคนที่ส่งคำขอ" };
    s.status = "cancelled"; outbox.push({ to: s.to, text: `${A.name} ยกเลิกคำขอ #${s.id}` }); save(); return { ok: `ยกเลิกคำขอ #${s.id} แล้ว` };
  }
  if (s.to !== id) return { err: "คำขอนี้ไม่ได้ส่งถึงคุณ" };
  if (op === "reject") { s.status = "rejected"; outbox.push({ to: s.from, text: `❌ ${B.name} ปฏิเสธคำขอ #${s.id}\n${describe(s)}` }); save(); return { ok: `ปฏิเสธคำขอ #${s.id} แล้ว` }; }
  const sa = shiftsOn(A, s.a), sb = s.kind === "swap" ? shiftsOn(B, s.b) : [1];
  if (!sa.length || !sb.length) { s.status = "invalid"; save(); return { err: `เวรของคำขอ #${s.id} เปลี่ยนไปแล้ว ใช้คำขอนี้ไม่ได้ ให้ขอใหม่` }; }
  if (s.kind === "swap") { const bs = shiftsOn(B, s.b); delete A.days[s.a]; delete B.days[s.b]; put(A, s.b, bs); put(B, s.a, sa); }
  else { delete A.days[s.a]; put(B, s.a, sa); }
  s.status = "accepted"; outbox.push({ to: s.from, text: `✅ ${B.name} รับคำขอ #${s.id} แล้ว ตารางเวรของคุณอัปเดตแล้ว\n${describe(s)}` });
  save(); return { ok: `รับคำขอ #${s.id} แล้ว ตารางเวรของทั้งสองฝ่ายอัปเดตแล้ว\n${describe(s)}` };
}
function teamInfo(u) {
  const t = tm(u); if (!t) return NOTEAM;
  return `ทีม "${t.name}" (${t.members.length} คน)\nรหัสทีม: ${u.team}\nสมาชิก: ${t.members.map(i => DB[i] && DB[i].name).filter(Boolean).join(", ")}\n\nชวนเพื่อน: ให้พิมพ์ เข้าทีม ${u.team}`;
}
function teamMonth(u, now) {
  const t = tm(u); if (!t) return NOTEAM; const { Y, M } = bkk(now);
  return `ตารางทีม ${t.name} ${MN[M]} ${Y + 543}\n` + t.members.map(i => DB[i]).filter(Boolean).map(m => {
    const a = []; for (let d = 1; d <= dim(Y, M); d++) { const s = shiftsOn(m, key(Y, M, d)).map(x => x.short); if (s.length) a.push(d + " " + s.join("+")); }
    return `${m.name}: ${a.join(", ") || "-"}`;
  }).join("\n");
}
function teamDay(u, arg, now) {
  const t = tm(u); if (!t) return NOTEAM; const k = dkey(arg, now); if (!k) return "วันที่ไม่ถูกต้อง";
  const ms = t.members.map(i => DB[i]).filter(Boolean), work = ms.filter(m => shiftsOn(m, k).length), off = ms.filter(m => (m.days[k] || []).some(i => (m.types.find(x => x.id === i) || {}).kind === "x"));
  return `ทีม ${t.name} วันที่ ${fd(k)}\n` + (work.map(m => `• ${m.name}: ${label(m, k)}`).join("\n") || "ไม่มีคนลงเวร") + (off.length ? `\nหยุด: ${off.map(m => m.name).join(", ")}` : "");
}
function pending(u, id) {
  const t = tm(u); if (!t) return NOTEAM;
  const L = t.swaps.filter(s => s.status === "pending" && (s.from === id || s.to === id)).map(s => `${describe(s)}\n  ${s.to === id ? `รอคุณตอบ → รับ ${s.id} / ปฏิเสธ ${s.id}` : `รอ ${DB[s.to].name} ตอบ (ยกเลิกคำขอ ${s.id})`}`);
  return L.length ? "คำขอที่รออยู่\n" + L.join("\n") : "ไม่มีคำขอที่รออยู่";
}
function teamCmd(u, id, t, now) {
  let m; const R = r => r.err || r.ok, D = "(\\d{1,2}(?:\\/\\d{1,2})?)";
  if ((m = t.match(/^สร้างทีม\s+(.+)$/))) return R(createTeam(u, id, m[1]));
  if ((m = t.match(/^เข้าทีม\s+(\S+)$/))) return R(joinTeam(u, id, m[1]));
  if (t === "ออกทีม") return R(leaveTeam(u, id));
  if (t === "ทีม") return teamInfo(u);
  if (t === "ตารางทีม") return teamMonth(u, now);
  if (t === "ทีมวันนี้") return teamDay(u, String(new Date(now.getTime() + 7 * 36e5).getUTCDate()), now);
  if ((m = t.match(new RegExp(`^ทีม\\s+${D}$`)))) return teamDay(u, m[1], now);
  if (t === "คำขอ") return pending(u, id);
  if ((m = t.match(new RegExp(`^แลกเวร\\s+${D}\\s+กับ\\s+(.+?)\\s+${D}$`)))) return R(newSwap(u, id, "swap", m[1], m[2], m[3], now));
  if ((m = t.match(new RegExp(`^ฝากเวร\\s+${D}\\s+ให้\\s+(.+)$`)))) return R(newSwap(u, id, "give", m[1], m[2], null, now));
  if ((m = t.match(/^(รับ|ปฏิเสธ|ยกเลิกคำขอ)\s+(\d+)$/))) return R(answer(u, id, m[2], { "รับ": "accept", "ปฏิเสธ": "reject", "ยกเลิกคำขอ": "cancel" }[m[1]]));
  return null;
}
function teamData(u, Y, M) {
  const t = tm(u); if (!t) return { team: null };
  const myId = idOf(u);
  const members = t.members.map(i => DB[i]).filter(Boolean).map(m => {
    const days = {}; for (let d = 1; d <= dim(Y, M); d++) { const a = ofMember(m, key(Y, M, d)).map(x => ({ s: x.short, c: color(x), x: x.kind === "x" })).filter(x => !x.x); if (a.length) days[d] = a; }
    return { name: m.name, me: m === u, days };
  });
  const swaps = t.swaps.filter(s => s.status === "pending" && (s.from === myId || s.to === myId)).map(s => ({ id: s.id, text: describe(s), incoming: s.to === myId }));
  return { team: { name: t.name, code: u.team, add: process.env.LINE_ADD_URL || "" }, me: u.name, members, swaps, others: members.filter(m => !m.me).map(m => m.name) };
}
async function profileName(id) {
  try { const r = await fetch("https://api.line.me/v2/bot/profile/" + id, { headers: { Authorization: "Bearer " + TOKEN } }); if (r.ok) return (await r.json()).displayName; } catch {}
  return null;
}
async function push(to, text) {
  try {
    const r = await fetch("https://api.line.me/v2/bot/message/push", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN }, body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }) });
    if (!r.ok) console.error("push failed", r.status, await r.text());
  } catch (e) { console.error("push error", e.message); }
}
const HELP = `วิธีใช้
• ลงเวร: พิมพ์ 16 เช้า / 17 บ่าย ดึก / 18 OT เช้า / 19 OFF (หลายบรรทัดได้)
• สรุป  หรือ  สรุป 9 — บอทจะถามว่าจะสรุป เวร หรือ ค่าใช้จ่าย (พิมพ์ สรุปเวร / สรุปจ่าย เพื่อข้ามคำถาม)
• ตาราง — ดูเวรเดือนนี้\n• ปฏิทิน — ขอลิงก์ปฏิทิน (บอทจะถามว่าจะใช้ ปฏิทินเวร หรือ ปฏิทินค่าใช้จ่าย)\n• ลิงก์ใหม่ — เปลี่ยนลิงก์ปฏิทิน
• ลบ 16 — ล้างเวรวันที่ 16
• ตั้งค่า — ดูค่าเวร
• ตั้งค่า เช้า 850 — แก้ค่าเวร
• เพิ่มเวร ควบ ค 1500 (ท้ายคำสั่งใส่ ot หรือ หยุด ได้)
• ลบเวร ควบ
• รายได้อื่น เงินเดือน 15000
• ลบรายได้อื่น เงินเดือน

ค่าอาหาร / ค่าใช้จ่าย (แยกตามประเภทและเมนู)
• จ่าย กลางวัน 60 ข้าวมันไก่ — รูปแบบ: ประเภท จำนวนเงิน เมนู (เมนูใส่หรือไม่ก็ได้) บันทึกของวันนี้
• จ่าย 16 เช้า 40 ไข่กระทะ / จ่าย 16/11 เย็น 80 กะเพรา — ระบุวันที่ (หลายบรรทัดได้)
• ประเภทเริ่มต้น: เช้า กลางวัน เย็น เครื่องดื่ม ของว่าง (เพิ่มเองได้ เช่น เพิ่มหมวด ค่าเดินทาง)
• สรุปจ่าย  หรือ  สรุปจ่าย 9 — สรุปรายประเภท แยกรายเมนู
• รายการจ่าย — ดูทั้งเดือน แยกเป็นรายวัน พร้อมยอดรวม
• รายการจ่าย 16 / 16 18 20 / 16-20 / 16/11 — ดูเฉพาะวันที่เลือก (วันเดียว หลายวัน หรือช่วง) แล้วสรุปให้ (เดือนอื่น: รายการจ่าย เดือน 9)
• ลบจ่าย 16  หรือ  ลบจ่าย 16 2 (ลบรายการที่ 2 ของวันที่ 16)
• ไม่จ่าย / ไม่จ่าย 16 / ไม่จ่าย 16-20 — บอกว่าวันนั้นไม่มีค่าใช้จ่าย (ยอด 0) เลือกหลายวันได้ ยกเลิกด้วย ลบจ่าย 16
• หมวด / เพิ่มหมวด ชานม / ลบหมวด ชานม
• งบ 15000 — ตั้งงบต่อเดือน

ทีม / แลกเวร
• สร้างทีม ตึก5 — แล้วส่งรหัสทีมเข้ากลุ่มให้เพื่อน
• เข้าทีม รหัส / ออกทีม / ทีม
• ชื่อ ฝน — ชื่อที่เพื่อนในทีมเห็น
• ตารางทีม — เวรของทุกคนเดือนนี้
• ทีมวันนี้  หรือ  ทีม 20 — ใครเข้าเวรอะไร
• แลกเวร 20 กับ ฝน 25 — ขอสลับเวรกัน
• ฝากเวร 20 ให้ ฝน — ยกเวรให้
• คำขอ / รับ 3 / ปฏิเสธ 3 / ยกเลิกคำขอ 3`;

function handle(id, text, now = new Date(), base = "") {
  const u = user(id), t = text.trim(), { Y, M } = bkk(now); let m;
  if (/^(ช่วยเหลือ|help|เมนู)$/i.test(t)) return HELP;
  const ak = asking.get(id);
  if (ak) {
    asking.delete(id);
    if (Date.now() - ak.t < 10 * 6e4) {
      const isShift = /^(1|เวร|ปฏิทินเวร|สรุปเวร)$/.test(t), isExp = /^(2|ค่าใช้จ่าย|จ่าย|อาหาร|ปฏิทินค่าใช้จ่าย|ปฏิทินจ่าย|สรุปค่าใช้จ่าย|สรุปจ่าย)$/.test(t);
      if (isShift || isExp) {
        if (ak.kind === "sum") return isExp ? expSummary(u, Y, ak.mo) : shiftSummary(u, Y, ak.mo);
        return calReply(u, base, isExp ? "exp" : "shift");
      }
    }
  }
  if ((m = t.match(/^สรุป(เวร)?\s*(\d{1,2})?$/))) {
    const mo = m[2] ? +m[2] - 1 : M; if (mo < 0 || mo > 11) return "เดือนต้องเป็น 1–12";
    if (m[1]) return shiftSummary(u, Y, mo);
    asking.set(id, { t: Date.now(), kind: "sum", mo }); return ASKSUM;
  }
  if (t === "ปฏิทิน" || t === "ลิงก์ใหม่") {
    const fresh = t === "ลิงก์ใหม่"; if (fresh) { u.token = null; tok(u); save(); }
    asking.set(id, { t: Date.now(), kind: "cal" });
    return (fresh ? "สร้างลิงก์ใหม่แล้ว (ลิงก์เก่าใช้ไม่ได้)\n\n" : "") + ASK;
  }
  if (t === "ปฏิทินเวร") return calReply(u, base, "shift");
  if (/^ปฏิทิน(ค่าใช้จ่าย|จ่าย)$/.test(t)) return calReply(u, base, "exp");
  if (t === "ตาราง") {
    const L = []; for (let d = 1; d <= dim(Y, M); d++) { const a = (u.days[key(Y, M, d)] || []).map(i => u.types.find(x => x.id === i)).filter(Boolean); if (a.length) L.push(d + " " + a.map(alias).join(" ")); }
    return `ตารางเวร ${MN[M]} ${Y + 543}\n` + (L.join("\n") || "ยังไม่มีเวร พิมพ์เช่น 16 เช้า");
  }
  if (t === "ตั้งค่า") return "ค่าเวร\n" + u.types.filter(x => x.kind !== "x").map(x => `${x.name}: ${fmt(x.rate)} บาท`).join("\n") + "\n\nรายได้อื่น\n" + (u.other.map(o => `${o.name}: ${fmt(o.amt)}`).join("\n") || "-");
  if ((m = t.match(/^ตั้งค่า\s+(.+?)\s+(\d+)$/))) { const x = find(u, m[1]); if (!x || x.kind === "x") return `ไม่พบเวร "${m[1]}"`; x.rate = +m[2]; save(); return `ตั้งค่า ${x.name} เป็น ${fmt(x.rate)} บาท`; }
  if ((m = t.match(/^เพิ่มเวร\s+(\S+)\s+(\S+)\s+(\d+)(?:\s+(ot|หยุด))?$/i))) {
    if (find(u, m[1]) || find(u, m[2])) return "ชื่อหรือตัวย่อนี้มีอยู่แล้ว";
    const kind = !m[4] ? "s" : m[4].toLowerCase() === "ot" ? "o" : "x";
    u.types.push({ id: "c" + Date.now(), name: m[1], short: m[2], rate: kind === "x" ? 0 : +m[3], kind }); save(); return `เพิ่ม ${m[1]} (${m[2]}) ${fmt(+m[3])} บาท แล้ว`;
  }
  if ((m = t.match(/^ลบเวร\s+(\S+)$/))) {
    const x = find(u, m[1]); if (!x) return `ไม่พบเวร "${m[1]}"`;
    u.types = u.types.filter(y => y !== x); Object.keys(u.days).forEach(k => { u.days[k] = u.days[k].filter(i => i !== x.id); if (!u.days[k].length) delete u.days[k]; });
    save(); return `ลบ ${x.name} แล้ว`;
  }
  if ((m = t.match(/^ลบ\s+(\d{1,2})$/))) { delete u.days[key(Y, M, +m[1])]; save(); return `ล้างเวรวันที่ ${m[1]} แล้ว`; }
  if ((m = t.match(/^รายได้อื่น\s+(\S+)\s+(\d+)$/))) { const o = u.other.find(x => x.name === m[1]); if (o) o.amt = +m[2]; else u.other.push({ name: m[1], amt: +m[2] }); save(); return `บันทึก ${m[1]} ${fmt(+m[2])} บาท`; }
  if ((m = t.match(/^ลบรายได้อื่น\s+(\S+)$/))) { u.other = u.other.filter(x => x.name !== m[1]); save(); return `ลบ ${m[1]} แล้ว`; }
  if ((m = t.match(/^ชื่อ\s+(.+)$/))) { const r = rename(u, id, m[1]); return r.err || r.ok; }
  const xr = expCmd(u, text, now); if (xr) return xr;
  const g = teamCmd(u, id, t, now); if (g) return g;
  const r = parseDays(u, text, Y, M), ds = Object.keys(r);
  if (!ds.length) return "ไม่เข้าใจข้อความ ลองพิมพ์ เช่น 16 เช้า หรือพิมพ์ ช่วยเหลือ";
  ds.forEach(d => { u.days[key(Y, M, d)] = r[d]; }); save();
  return `บันทึก ${ds.length} วัน แล้ว\nรายได้เดือนนี้ ${fmt(calc(u, Y, M).total)} บาท`;
}

async function reply(token, text) {
  const r = await fetch("https://api.line.me/v2/bot/message/reply", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ replyToken: token, messages: [{ type: "text", text: text.slice(0, 4900) }] }) });
  if (!r.ok) console.error("reply failed", r.status, await r.text());
}
function api(req, res, t, act, url) {
  const u = byTok(t), send = (c, o) => { res.writeHead(c, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(o)); };
  if (!u) return send(404, { error: "not found" });
  const now = bkk(new Date());
  if (act === "month" && req.method === "GET") {
    const q = url.searchParams, Y = q.has("y") ? +q.get("y") : now.Y, M = q.has("m") ? +q.get("m") : now.M;
    if (!(M >= 0 && M <= 11)) return send(400, { error: "bad month" });
    return send(200, monthData(u, Y, M));
  }
  if (act === "team" && req.method === "GET") {
    const q = url.searchParams, Y = q.has("y") ? +q.get("y") : now.Y, M = q.has("m") ? +q.get("m") : now.M;
    return send(200, teamData(u, Y, M >= 0 && M <= 11 ? M : now.M));
  }
  if (act === "exp" && req.method === "GET") {
    const q = url.searchParams, Y = q.has("y") ? +q.get("y") : now.Y, M = q.has("m") ? +q.get("m") : now.M;
    if (!(M >= 0 && M <= 11) || !Number.isInteger(Y)) return send(400, { error: "bad month" });
    return send(200, expData(u, Y, M));
  }
  if (req.method !== "POST") return send(405, { error: "method" });
  const chunks = []; let n = 0;
  req.on("data", c => { n += c.length; if (n < 1e5) chunks.push(c); });
  req.on("end", () => {
    try {
      const b = JSON.parse(Buffer.concat(chunks)), kd = i => u.types.find(x => x.id === i);
      const str = (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "";
      const num = v => Math.min(1e6, Math.max(0, Math.round(+v) || 0));
      const okc = c => /^#[0-9a-f]{6}$/i.test(c);
      const y = +b.y, m = +b.m, [Y, M] = Number.isInteger(y) && m >= 0 && m <= 11 ? [y, m] : [now.Y, now.M];
      const strip = id => Object.keys(u.days).forEach(k => { u.days[k] = u.days[k].filter(i => i !== id); if (!u.days[k].length) delete u.days[k]; });
      const done = extra => { save(); send(200, Object.assign(monthData(u, Y, M), extra)); };
      if (act === "day") {
        const d = +b.d; if (!(d >= 1 && d <= dim(Y, M))) return send(400, { error: "bad date" });
        let ids = [...new Set((b.ids || []).filter(kd))];
        if (ids.some(i => kd(i).kind === "x")) ids = ids.filter(i => kd(i).kind === "x").slice(0, 1);
        const k = key(Y, M, d); if (ids.length) u.days[k] = ids; else delete u.days[k];
        return done();
      }
      if (act === "type") {
        if (b.op === "add") {
          const name = str(b.name, 30), kind = ["s", "o", "x"].includes(b.kind) ? b.kind : "s";
          const short = str(b.short, 6) || (kind === "o" ? "OT" : name.replace(/^เวร/, "").slice(0, 2));
          if (!name) return send(400, { error: "ต้องใส่ชื่อเวร" });
          if (find(u, name) || (short.toLowerCase() !== "ot" && find(u, short))) return send(409, { error: "ชื่อหรือตัวย่อนี้มีอยู่แล้ว" });
          u.types.push({ id: "c" + Date.now(), name, short, rate: kind === "x" ? 0 : num(b.rate), kind, color: okc(b.color) ? b.color : undefined });
        } else if (b.op === "update") {
          const x = kd(b.id); if (!x) return send(404, { error: "ไม่พบเวร" });
          if (b.name !== undefined) { const nm = str(b.name, 30); if (!nm) return send(400, { error: "ต้องใส่ชื่อเวร" }); x.name = nm; }
          if (b.rate !== undefined && x.kind !== "x") x.rate = num(b.rate);
          if (b.short !== undefined) x.short = str(b.short, 6) || x.short;
          if (okc(b.color)) x.color = b.color;
        } else if (b.op === "delete") {
          const x = kd(b.id); if (!x) return send(404, { error: "ไม่พบเวร" });
          u.types = u.types.filter(y => y !== x); strip(x.id);
        } else return send(400, { error: "bad op" });
        return done();
      }
      if (act === "other") {
        if (b.op === "add") {
          const name = str(b.name, 30), amt = num(b.amt); if (!name || !amt) return send(400, { error: "ต้องใส่ชื่อและจำนวนเงิน" });
          const o = u.other.find(x => x.name === name); if (o) o.amt = amt; else u.other.push({ name, amt });
        } else if (b.op === "delete") u.other = u.other.filter(x => x.name !== b.name);
        else return send(400, { error: "bad op" });
        return done();
      }
      if (act === "import") {
        const r = parseDays(u, str(b.text, 20000), Y, M), ds = Object.keys(r);
        ds.forEach(d => { u.days[key(Y, M, d)] = r[d]; });
        return done({ imported: ds.length });
      }
      if (act === "exp") {
        const x = ex(u); let extra;
        if (b.op === "add") {
          const d = +b.d; if (!(d >= 1 && d <= dim(Y, M))) return send(400, { error: "bad date" });
          if (!x.cats.some(c => c.id === b.cat)) return send(400, { error: "เลือกหมวดก่อน" });
          const r = addExp(x, key(Y, M, d), b.cat, b.amt, str(b.note, 40)); if (r.err) return send(400, { error: r.err });
        } else if (b.op === "del") {
          const k = key(Y, M, +b.d), l = (x.items[k] || []).filter(i => i.i !== b.id); if (l.length) x.items[k] = l; else delete x.items[k];
        } else if (b.op === "catadd") {
          const r = addCat(x, str(b.name, 20), b.color); if (r.err) return send(400, { error: r.err });
        } else if (b.op === "catupd") {
          const c = x.cats.find(i => i.id === b.id); if (!c) return send(404, { error: "ไม่พบหมวด" });
          if (b.name !== undefined) {
            const nm = str(b.name, 20); if (!nm) return send(400, { error: "ต้องใส่ชื่อหมวด" });
            if (x.cats.some(i => i !== c && i.name.toLowerCase() === nm.toLowerCase())) return send(409, { error: "มีหมวดนี้แล้ว" });
            c.name = nm;
          }
          if (okc(b.color)) c.color = b.color;
        } else if (b.op === "catdel") x.cats = x.cats.filter(i => i.id !== b.id);
        else if (b.op === "none") {
          const ds = [...new Set((Array.isArray(b.ds) ? b.ds : [b.d]).map(Number))].filter(d => Number.isInteger(d) && d >= 1 && d <= dim(Y, M)).slice(0, 31);
          if (!ds.length) return send(400, { error: "bad date" });
          let skipped = 0;
          ds.forEach(d => { const k = key(Y, M, d); if ((x.items[k] || []).length) { if (b.force) delete x.items[k]; else { skipped++; return; } } x.none[k] = 1; });
          if (skipped && ds.length === 1) return send(400, { error: "วันนี้มีรายการจ่ายอยู่ ต้องล้างรายการก่อนจึงจะตั้งเป็นไม่มีค่าใช้จ่ายได้" });
          extra = { skipped };
        } else if (b.op === "unnone") {
          const d = +b.d; if (!(d >= 1 && d <= dim(Y, M))) return send(400, { error: "bad date" });
          delete x.none[key(Y, M, d)];
        }
        else if (b.op === "budget") x.budget = Math.min(1e8, Math.max(0, r2(+b.amt || 0)));
        else return send(400, { error: "bad op" });
        save(); return send(200, Object.assign(expData(u, Y, M), extra));
      }
      if (act === "team" || act === "swap") {
        const id = idOf(u); let r;
        if (act === "team") r = b.op === "create" ? createTeam(u, id, str(b.name, 30)) : b.op === "join" ? joinTeam(u, id, str(b.code, 12)) : b.op === "leave" ? leaveTeam(u, id) : b.op === "name" ? rename(u, id, str(b.name, 20)) : { err: "bad op" };
        else r = b.op === "new" ? newSwap(u, id, b.kind === "give" ? "give" : "swap", String(b.a), str(b.name, 20), String(b.b), new Date()) : ["accept", "reject", "cancel"].includes(b.op) ? answer(u, id, b.id, b.op) : { err: "bad op" };
        if (r.err) return send(400, { error: r.err });
        save(); flush();
        return send(200, Object.assign(teamData(u, Y, M), { msg: r.ok }));
      }
      send(404, { error: "not found" });
    } catch { send(400, { error: "bad request" }); }
  });
}
module.exports = { handle, outbox };
if (require.main === module) {
  if (!SECRET || !TOKEN) { console.error("ตั้งค่าไม่ครบ ยังไม่ได้ใส่ใน Environment:", [!SECRET && "LINE_CHANNEL_SECRET", !TOKEN && "LINE_CHANNEL_ACCESS_TOKEN"].filter(Boolean).join(", ")); process.exit(1); }
  let host = "-"; try { host = new URL(SB_URL).host; } catch {}
  console.log("storage:", useSB ? "supabase (" + host + ")" : "ไฟล์ " + FILE);
  loadDB().then(() => http.createServer((req, res) => {
    const url = new URL(req.url, "http://x"), base = process.env.BASE_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
    let m;
    if (req.method === "GET" && (m = url.pathname.match(/^\/c\/(\w+)$/))) {
      if (!byTok(m[1])) { res.writeHead(404).end("not found"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      res.end(fs.readFileSync(__dirname + "/calendar.html")); return;
    }
    if ((m = url.pathname.match(/^\/api\/(\w+)\/(month|day|type|other|import|team|swap|exp)$/))) { api(req, res, m[1], m[2], url); return; }
    if (req.method !== "POST") { res.end("shift bot ok"); return; }
    const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const sig = crypto.createHmac("sha256", SECRET).update(raw).digest("base64");
      if (sig !== req.headers["x-line-signature"]) { res.writeHead(401).end("bad signature"); return; }
      res.writeHead(200).end("ok");
      try { (JSON.parse(raw).events || []).forEach(ev => {
        if (ev.type === "message" && ev.message.type === "text" && ev.source.userId) (async () => {
          const id = ev.source.userId, text = ev.message.text.trim();
          if (ev.source.type !== "user" && !/^(ตารางทีม|ทีมวันนี้|ทีม\s+\d{1,2}(\/\d{1,2})?)$/.test(text)) return; // ในกลุ่มตอบเฉพาะคำสั่งดูตารางทีม (ไม่เปิดเผยรายได้)
          const u = user(id); if (!u.name && ev.source.type === "user") { const n = await profileName(id); if (n) { u.name = n.slice(0, 20); save(); } }
          await reply(ev.replyToken, handle(id, ev.message.text, new Date(), base)); flush();
        })().catch(console.error);
        if (ev.type === "follow") reply(ev.replyToken, "สวัสดีครับ ผมช่วยลงเวรและคำนวณรายได้ให้\n\n" + HELP).catch(console.error);
      }); } catch (e) { console.error(e); }
    });
  }).listen(PORT, () => console.log("listening on " + PORT))).catch(e => { console.error("โหลดข้อมูลจาก Supabase ไม่ได้ ตรวจ SUPABASE_URL / SUPABASE_KEY และตาราง bot_data |", e.message, e.cause ? "| " + (e.cause.message || e.cause) : ""); process.exit(1); });
}
