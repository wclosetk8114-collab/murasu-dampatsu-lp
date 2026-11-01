// 共通：Supabase(管理用RPC) / Stripe / メール / 紹介特典の返金
const SB = "https://cczerefroeveoobdlhoj.supabase.co/rest/v1";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjemVyZWZyb2V2ZW9vYmRsaG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4OTg1NjYsImV4cCI6MjEwMzQ3NDU2Nn0.KsQtf2gYD5EOFYB9Jq-uH8pHI1dVIrUH99J0qkUJy54";
const MAIL_FROM = process.env.MAIL_FROM || "村主悠真×つっちー 講演会事務局 <hello@musubi-kakeizu.com>";
const NOTIFY_TO = process.env.NOTIFY_TO || "w.closet.k8114@gmail.com";
const REPLY_TO = process.env.REPLY_TO || "kyoten.zimukyoku@gmail.com";
const SITE = "https://murasu-dampatsu-lp.vercel.app";
const PRICES = { "11/4 オンライン対談": 0, "11/27 講演会": 5500, "11/27 懇親会": 11000, "12/21 虚点": 11000 };
const HALF = ["11/27 講演会", "11/27 懇親会"];
const yen = (n) => Number(n).toLocaleString("ja-JP") + "円";
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function person(plans, stu) {
  let p = plans.reduce((a, k) => a + (stu && HALF.includes(k) ? PRICES[k] / 2 : PRICES[k] || 0), 0);
  if (plans.includes("11/27 講演会") && plans.includes("11/27 懇親会")) p -= stu ? 750 : 1500;
  return p;
}

async function rpc(fn, args) {
  const r = await fetch(`${SB}/rpc/${fn}`, { method: "POST", headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ p_secret: process.env.ADMIN_SECRET, ...args }) });
  if (!r.ok) throw new Error(fn + " " + r.status);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function stripe(method, path, form) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method, headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  if (!r.ok) return null;
  return r.json();
}

async function sendMail(to, subject, html, bcc) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to, bcc, reply_to: REPLY_TO, subject, html }),
  });
  return r.ok;
}

// 決済済みかStripeに確認して、済んでいればDBに記録
async function confirmSession(sessionId) {
  const s = await stripe("GET", "checkout/sessions/" + encodeURIComponent(sessionId));
  if (!s || s.payment_status !== "paid") return false;
  await rpc("adm_mark_paid", { p_session: sessionId });
  return true;
}

// 2人以上（支払い済み）紹介した人が、すでに払っていたら本人分を自動返金
async function runReferralRefunds() {
  const done = [];
  const list = (await rpc("adm_refund_candidates", {})) || [];
  for (const a of list) {
    const own = a.pair ? Math.max(0, person(a.plans || [], a.student) - 1500) : a.total;
    if (!own) continue;
    const s = await stripe("GET", "checkout/sessions/" + encodeURIComponent(a.stripe_session_id));
    if (!s || !s.payment_intent) continue;
    const rf = await stripe("POST", "refunds", { payment_intent: s.payment_intent, amount: String(own), "metadata[reason]": "referral_free" });
    if (!rf || !rf.id) continue;
    await rpc("adm_mark_refunded", { p_id: a.id, p_amount: own, p_refund: rf.id });
    await sendMail([a.email], "【紹介特典】参加費を返金しました ─ 2027年をどう生きるか",
      `<div style="font-family:sans-serif;line-height:1.9;color:#2a2f3a;max-width:560px"><p>${esc(a.name)} 様</p>
<p>お知り合いを${a.referred}名ご紹介いただき、ありがとうございます。<br>紹介特典として、${esc(a.name)} 様ご本人の参加費 <b>${yen(own)}</b> を返金しました。</p>
<p>カード会社によって、返金の反映まで数日〜1か月ほどかかる場合があります。</p>
<p>当日お会いできるのを楽しみにしています。</p><p>つっちー（結び）</p></div>`, [NOTIFY_TO]).catch(() => {});
    done.push({ id: a.id, amount: own });
  }
  return done;
}

module.exports = { SB, SB_KEY, SITE, PRICES, HALF, yen, esc, person, rpc, stripe, sendMail, confirmSession, runReferralRefunds };
