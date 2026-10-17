// LINE bot คำนวณเวร — ไม่ต้อง npm install (ใช้ Node 18+)
const http = require("http"), crypto = require("crypto"), fs = require("fs");
const SECRET = process.env.LINE_CHANNEL_SECRET, TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const FILE = process.env.DATA_FILE || "./data.json", PORT = process.env.PORT || 3000;
const MN = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const T0 = () => [["m","เวรเช้า","ช",800,"s"],["a","เวรบ่าย","บ",900,"s"],["n","เวรดึก","ด",1000,"s"],
  ["om","OT เช้า","OT",700,"o"],["oa","OT บ่าย","OT",900,"o"],["on","OT ดึก","OT",800,"o"],["x","OFF","OFF",0,"x"]]
  .map(([id,name,short,rate,kind]) => ({id,name,short,rate,kind}));
let DB = {}; try { DB = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(DB)); } catch (e) { console.error(e); } };
const user = id => DB[id] || (DB[id] = { types: T0(), other: [], days: {} });
const tok = u => u.token || (u.token = crypto.randomBytes(16).toString("hex"));
const byTok = t => Object.values(DB).find(u => u.token && u.token === t);
const COL = { m: "#f5b83d", a: "#ee8a4b", n: "#3b2fd8" };
const color = t => t.color || COL[t.id] || (t.kind === "o" ? "#17a589" : t.kind === "x" ? "#9a97b3" : "#e0457b");
const fmt = n => Math.round(n).toLocaleString("th-TH");
const pad = n => String(n).padStart(2, "0");
const alias = t => t.name.replace(/^เวร/, "") || t.name;
const bkk = now => { const d = new Date(now.getTime() + 7 * 36e5); return { Y: d.getUTCFullYear(), M: d.getUTCMonth() }; };
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
const HELP = `วิธีใช้
• ลงเวร: พิมพ์ 16 เช้า / 17 บ่าย ดึก / 18 OT เช้า / 19 OFF (หลายบรรทัดได้)
• สรุป  หรือ  สรุป 9 (เดือนที่ 9)
• ตาราง — ดูเวรเดือนนี้\n• ปฏิทิน — ขอลิงก์ปฏิทิน (ดู/แก้เวรบนเว็บได้ ข้อมูลตรงกับแชท)\n• ลิงก์ใหม่ — เปลี่ยนลิงก์ปฏิทิน
• ลบ 16 — ล้างเวรวันที่ 16
• ตั้งค่า — ดูค่าเวร
• ตั้งค่า เช้า 850 — แก้ค่าเวร
• เพิ่มเวร ควบ ค 1500 (ท้ายคำสั่งใส่ ot หรือ หยุด ได้)
• ลบเวร ควบ
• รายได้อื่น เงินเดือน 15000
• ลบรายได้อื่น เงินเดือน`;

function handle(id, text, now = new Date(), base = "") {
  const u = user(id), t = text.trim(), { Y, M } = bkk(now); let m;
  if (/^(ช่วยเหลือ|help|เมนู)$/i.test(t)) return HELP;
  if ((m = t.match(/^สรุป\s*(\d{1,2})?$/))) {
    const mo = m[1] ? +m[1] - 1 : M; if (mo < 0 || mo > 11) return "เดือนต้องเป็น 1–12";
    const c = calc(u, Y, mo);
    return `สรุป ${MN[mo]} ${Y + 543}\nเวรปกติ ${c.ns} เวร: ${fmt(c.ms)}\nOT ${c.no} เวร: ${fmt(c.mo)}\nรายได้อื่น: ${fmt(c.oth)}\nวันหยุด ${c.nx} วัน\nรวม ${fmt(c.total)} บาท`;
  }
  if (t === "ปฏิทิน" || t === "ลิงก์ใหม่") {
    if (t === "ลิงก์ใหม่") u.token = null; const l = tok(u); save();
    return (t === "ลิงก์ใหม่" ? "สร้างลิงก์ใหม่แล้ว (ลิงก์เก่าใช้ไม่ได้)\n" : "ปฏิทินเวรของคุณ\n") + `${base}/c/${l}\n(ลิงก์ส่วนตัว ใครมีลิงก์ก็ดูและแก้ได้ อย่าแชร์)`;
  }
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
      send(404, { error: "not found" });
    } catch { send(400, { error: "bad request" }); }
  });
}
module.exports = { handle };
if (require.main === module) {
  if (!SECRET || !TOKEN) { console.error("ตั้งค่า LINE_CHANNEL_SECRET และ LINE_CHANNEL_ACCESS_TOKEN ก่อน"); process.exit(1); }
  http.createServer((req, res) => {
    const url = new URL(req.url, "http://x"), base = process.env.BASE_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
    let m;
    if (req.method === "GET" && (m = url.pathname.match(/^\/c\/(\w+)$/))) {
      if (!byTok(m[1])) { res.writeHead(404).end("not found"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      res.end(fs.readFileSync(__dirname + "/calendar.html")); return;
    }
    if ((m = url.pathname.match(/^\/api\/(\w+)\/(month|day|type|other|import)$/))) { api(req, res, m[1], m[2], url); return; }
    if (req.method !== "POST") { res.end("shift bot ok"); return; }
    const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const sig = crypto.createHmac("sha256", SECRET).update(raw).digest("base64");
      if (sig !== req.headers["x-line-signature"]) { res.writeHead(401).end("bad signature"); return; }
      res.writeHead(200).end("ok");
      try { (JSON.parse(raw).events || []).forEach(ev => {
        if (ev.type === "message" && ev.message.type === "text" && ev.source.userId) reply(ev.replyToken, handle(ev.source.userId, ev.message.text, new Date(), base)).catch(console.error);
        if (ev.type === "follow") reply(ev.replyToken, "สวัสดีครับ ผมช่วยลงเวรและคำนวณรายได้ให้\n\n" + HELP).catch(console.error);
      }); } catch (e) { console.error(e); }
    });
  }).listen(PORT, () => console.log("listening on " + PORT));
}
