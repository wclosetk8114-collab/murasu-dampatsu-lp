const { rpc } = require("./_lib");
// 申し込み受付：Supabaseに保存 → 確認メール送信（RESEND_API_KEY があるとき）
const SB_URL = "https://cczerefroeveoobdlhoj.supabase.co/rest/v1/event_applications";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjemVyZWZyb2V2ZW9vYmRsaG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4OTg1NjYsImV4cCI6MjEwMzQ3NDU2Nn0.KsQtf2gYD5EOFYB9Jq-uH8pHI1dVIrUH99J0qkUJy54";
const MAIL_FROM = process.env.MAIL_FROM || "村主悠真×つっちー 講演会事務局 <hello@musubi-kakeizu.com>";
const NOTIFY_TO = process.env.NOTIFY_TO || "w.closet.k8114@gmail.com";
const REPLY_TO = process.env.REPLY_TO || "kyoten.zimukyoku@gmail.com";
const OPENCHAT = "https://line.me/ti/g2/A6vHp2wI6sO00NYHovnl-rYSg7fXp-voM7pEjQ";
const SITE = "https://murasu-dampatsu-lp.vercel.app";

const PRICES = { "11/4 オンライン対談": 0, "11/27 講演会": 5500, "11/27 懇親会": 11000, "12/21 虚点": 11000, "12/21 虚点（オンライン）": 11000 };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const s = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const yen = (n) => n.toLocaleString("ja-JP") + "円";

const HALF = ["11/27 講演会", "11/27 懇親会"];
function person(plans, stu) {
  let p = plans.reduce((a, k) => a + (stu && HALF.includes(k) ? PRICES[k] / 2 : PRICES[k] || 0), 0);
  if (plans.includes("11/27 講演会") && plans.includes("11/27 懇親会")) p -= stu ? 750 : 1500;
  return p;
}
function calc(plans, pair, stu, pstu, free) {
  const set = plans.includes("11/27 講演会") && plans.includes("11/27 懇親会");
  const a = free ? 0 : person(plans, stu);
  if (!pair) return { total: a, set };
  const b = person(plans, pstu);
  return { total: Math.max(0, a - 1500) + Math.max(0, b - 1500), set };
}

async function checkout(key, { total, name, email, plans, pair, id }) {
  const f = new URLSearchParams();
  f.append("mode", "payment");
  f.append("locale", "ja");
  f.append("customer_email", email);
  f.append("success_url", SITE + "/?paid=1&session_id={CHECKOUT_SESSION_ID}#apply");
  f.append("cancel_url", SITE + "/?cancel=1#apply");
  f.append("line_items[0][quantity]", "1");
  f.append("line_items[0][price_data][currency]", "jpy");
  f.append("line_items[0][price_data][unit_amount]", String(total));
  f.append("line_items[0][price_data][product_data][name]", "2027年をどう生きるか ─ 村主悠真×つっちー" + (pair ? "（2名）" : ""));
  f.append("line_items[0][price_data][product_data][description]", plans.join(" / "));
  f.append("metadata[name]", name);
  f.append("metadata[plans]", plans.join(" / "));
  f.append("metadata[pair]", pair ? "yes" : "no");
  f.append("metadata[app_ref]", id);
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString(),
  });
  if (!r.ok) return null;
  return r.json();
}

async function sendMail(key, to, subject, html, bcc) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to, bcc, reply_to: REPLY_TO, subject, html }),
  });
  return r.ok;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const name = s(b.name, 100), email = s(b.email, 200);
  const plans = Array.isArray(b.plans) ? b.plans.filter((p) => p in PRICES) : [];
  const pair = !!b.pair;
  const pair_name = pair ? s(b.pair_name, 100) : "";
  const pair_email = pair ? s(b.pair_email, 200) : "";
  const referrer = s(b.referrer, 100), ref_code = s(b.ref_code, 100);
  const message = s(b.message, 1000);
  if (!name || !EMAIL_RE.test(email) || !plans.length) return res.status(400).json({ error: "input" });
  if (pair && (!pair_name || !EMAIL_RE.test(pair_email))) return res.status(400).json({ error: "pair" });
  const student = !!b.student, pair_student = pair && !!b.pair_student;
  // 紹介特典：支払い済みの人を2人以上紹介した人は本人分が無料（ページには書かない）
  let free = false;
  try { free = (await rpc("adm_paid_referral_count", { p_name: name })) >= 2; } catch {}
  const { total, set } = calc(plans, pair, student, pair_student, free);

  // 有料ならStripeの決済画面をつくる（STRIPE_SECRET_KEY があるとき）
  let session = null;
  const skey = process.env.STRIPE_SECRET_KEY;
  if (skey && total > 0) {
    session = await checkout(skey, { total, name, email, plans, pair, id: Date.now().toString(36) });
    if (!session) return res.status(502).json({ error: "stripe" });
  }

  const row = { event_key: "murasu-2026winter", name, email, plans, pair, pair_name: pair_name || null, pair_email: pair_email || null,
    referrer: referrer || null, ref_code: ref_code || null, message: message || null, total, student, pair_student, free_by_referral: free, stripe_session_id: session ? session.id : null };
  const ins = await fetch(SB_URL, { method: "POST", headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(row) });
  if (!ins.ok) return res.status(500).json({ error: "save" });

  const key = process.env.RESEND_API_KEY;
  let mailed = false;
  if (key) {
    const list = plans.map((p) => `<li>${esc(p)}（${PRICES[p] ? yen(student && HALF.includes(p) ? PRICES[p] / 2 : PRICES[p]) : "無料"}）</li>`).join("");
    const extra = [free ? "紹介特典（ご本人分 無料）" : "", set ? "講演会＋懇親会セット" : "", student ? "学生半額" : "", pair_student ? "同伴者 学生半額" : "", pair ? "ペア割（1人1,500円オフ）" : ""].filter(Boolean).join("／");
    const body = `<div style="font-family:sans-serif;line-height:1.9;color:#2a2f3a;max-width:560px">
<p>${esc(name)} 様</p>
<p>「2027年をどう生きるか ─ 村主悠真 × つっちー」にお申し込みいただき、ありがとうございます。<br>以下の内容で受け付けました。</p>
<div style="border:1px solid #d8cdb6;padding:16px 20px;margin:16px 0">
<b>参加する回</b><ul style="margin:6px 0 10px">${list}</ul>
${pair ? `<b>一緒に参加する方</b><br>${esc(pair_name)} 様<br><br>` : ""}
${referrer ? `<b>紹介者</b><br>${esc(referrer)}<br><br>` : ""}
<b>合計</b>：${yen(total)}${pair ? "（2人分）" : ""}${extra ? `<br><small>${extra} 適用</small>` : ""}
</div>
${session ? `<p><b>お支払いについて</b><br>お申し込みのあと表示されたカード決済の画面でお支払いください。まだお済みでない場合は、下のリンクから24時間以内にお支払いいただけます。<br><a href="${session.url}">お支払いページを開く</a></p>` : ""}<p>会場・時間の詳細は、あらためてご連絡します。</p>
<div style="border:1px solid #06c755;background:#f3fcf6;padding:16px 20px;margin:16px 0">
<b>LINEオープンチャットにご参加ください</b><br>
「村主悠真×つっちー｜11/4 20時〜オンライン｜11/27夜 講演会＆懇親会｜12/21夜 虚点」<br>
会場・時間のお知らせ、当日の案内はこちらで発信します。<br>
<a href="${OPENCHAT}" style="display:inline-block;margin-top:10px;background:#06c755;color:#fff;text-decoration:none;padding:10px 22px;border-radius:2px">オープンチャットに参加する</a><br>
<small>${OPENCHAT}</small>
</div>
<p>イベントページ：<a href="${SITE}">${SITE}</a></p>
<p>ご不明な点は、このメールにそのまま返信してください。</p>
<p>つっちー（結び）</p></div>`;
    const subject = "【お申し込み受付】2027年をどう生きるか ─ 村主悠真 × つっちー";
    const to = pair ? [email, pair_email] : [email];
    try { mailed = await sendMail(key, to, subject, body, [NOTIFY_TO]); } catch { mailed = false; }
  }
  return res.status(200).json({ ok: true, mailed, checkout_url: session ? session.url : null });
};
