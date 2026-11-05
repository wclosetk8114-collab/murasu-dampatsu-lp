// 共通：Supabase(管理用RPC) / Stripe / メール / 紹介特典の返金
const SB = "https://cczerefroeveoobdlhoj.supabase.co/rest/v1";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjemVyZWZyb2V2ZW9vYmRsaG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4OTg1NjYsImV4cCI6MjEwMzQ3NDU2Nn0.KsQtf2gYD5EOFYB9Jq-uH8pHI1dVIrUH99J0qkUJy54";
const MAIL_FROM = process.env.MAIL_FROM || "村主悠真×つっちー 講演会事務局 <hello@musubi-kakeizu.com>";
const NOTIFY_TO = process.env.NOTIFY_TO || "w.closet.k8114@gmail.com";
const REPLY_TO = process.env.REPLY_TO || "kyoten.zimukyoku@gmail.com";
const SITE = "https://murasu-dampatsu-lp.vercel.app";
const PRICES = { "11/4 オンライン対談": 0, "11/27 講演会": 6600, "11/27 講演会（オンライン）": 6600, "11/27 講演会＋懇親会セット": 15500, "12/21 虚点": 11000, "12/21 虚点（オンライン）": 11000,
  "冬の通し券（会場）": 24400, "冬の通し券 ライト（会場）": 15800, "冬の通し券 ライト（オンライン）": 15800, "11/4 対談アーカイブ": 1000 };
const ARCH = "11/4 対談アーカイブ", ARCH_PRICE = 1000, ARCH_URL = "https://youtu.be/eV8eeX3alE0";
const PASSES = ["冬の通し券（会場）", "冬の通し券 ライト（会場）", "冬の通し券 ライト（オンライン）"];
const HALF = ["11/27 講演会", "11/27 講演会（オンライン）", "11/27 講演会＋懇親会セット"].concat(PASSES);
const LIMITS = { "11/27 講演会＋懇親会セット": 30, "12/21 虚点": 20 };
// 定員の数え方：通し券（会場）はセットと虚点会場を1席ずつ、ライト（会場）は虚点会場を1席使う
const SEAT_USERS = { "11/27 講演会＋懇親会セット": ["11/27 講演会＋懇親会セット", "冬の通し券（会場）"], "12/21 虚点": ["12/21 虚点", "冬の通し券（会場）", "冬の通し券 ライト（会場）"] };
const NEEDS = { "冬の通し券（会場）": ["11/27 講演会＋懇親会セット", "12/21 虚点"], "冬の通し券 ライト（会場）": ["12/21 虚点"], "11/27 講演会＋懇親会セット": ["11/27 講演会＋懇親会セット"], "12/21 虚点": ["12/21 虚点"] };
// 旧料金（2026-11-03より前の申し込み）の返金計算用
const LEGACY = { "11/27 講演会": 5500, "11/27 講演会（オンライン）": 5500, "11/27 懇親会": 11000 };
const yen = (n) => Number(n).toLocaleString("ja-JP") + "円";
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 早割：2026/11/6 23:59（日本時間）までの申し込みは、11/27の講演会・セットが1人1,000円オフ
const EARLY_END = new Date("2026-11-06T23:59:59+09:00");
const EARLY_OFF = 1000;
const isEarly = (d) => (d ? new Date(d) : new Date()) <= EARLY_END;
function person(plans, stu, legacy, early) {
  const T = legacy ? Object.assign({}, PRICES, LEGACY) : PRICES;
  const H = legacy ? HALF.concat(["11/27 懇親会"]) : HALF;
  let p = plans.filter((k) => k !== ARCH).reduce((a, k) => a + (stu && H.includes(k) ? (T[k] || 0) / 2 : T[k] || 0), 0);
  if (legacy && plans.includes("11/27 講演会") && plans.includes("11/27 懇親会")) p -= stu ? 750 : 1500;
  if (early && !legacy && plans.some((k) => k.startsWith("11/27"))) p -= EARLY_OFF;
  return Math.max(0, p);
}
// 紹介特典：支払い済みの人を2人以上紹介した人は「11/27 講演会」が無料（セットの人は講演会分を引く）
const LECTURE_PLANS = ["11/27 講演会", "11/27 講演会（オンライン）", "11/27 講演会＋懇親会セット"].concat(PASSES);
function lectureValue(plans, stu) {
  return (plans || []).some((k) => LECTURE_PLANS.includes(k)) ? (stu ? 3300 : 6600) : 0;
}
async function remaining() {
  const out = {};
  for (const k of Object.keys(LIMITS)) {
    let used = 0;
    for (const u of SEAT_USERS[k] || [k]) { try { used += (await rpc("adm_plan_count", { p_plan: u })) || 0; } catch {} }
    out[k] = Math.max(0, LIMITS[k] - used);
  }
  return out;
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
  const key = (process.env.RESEND_API_KEY || process.env.resend);
  if (!key) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to, bcc, reply_to: REPLY_TO, subject, html }),
  });
  return r.ok;
}

// アーカイブ購入者に、支払い確認後にURLを送る（1回だけ）
async function sendArchive(s) {
  const m = s.metadata || {};
  if (m.archive !== "yes" || m.archive_sent === "yes") return;
  await stripe("POST", "checkout/sessions/" + encodeURIComponent(s.id), { "metadata[archive_sent]": "yes" });
  const to = [s.customer_email || (s.customer_details && s.customer_details.email)].concat(m.pair_email ? [m.pair_email] : []).filter(Boolean);
  if (!to.length) return;
  await sendMail(to, "【アーカイブのご案内】11/4 村主悠真×つっちー オンライン対談",
    `<div style="font-family:sans-serif;line-height:1.9;color:#2a2f3a;max-width:560px">
<p>${esc(m.name || "")} 様</p>
<p>こんにちは、つっちーです。<br>11/4 オンライン対談のアーカイブをお申し込みいただき、ありがとうございます。<br>お支払いを確認しました。</p>
<div style="border:2px solid #b8963e;background:#fbf8f1;padding:16px 20px;margin:16px 0">
<b>▼ アーカイブはこちら</b><br>
<a href="${ARCH_URL}" style="display:inline-block;margin-top:10px;background:#16305a;color:#fff;text-decoration:none;padding:10px 22px;border-radius:2px">アーカイブを見る</a><br>
<small>${ARCH_URL}</small>
</div>
<p>※ このURLは、ご購入いただいた方だけのご案内です。ほかの方への共有はご遠慮ください。</p>
<p>村主さんがどんな人生を歩み、いま何を見ているのか。そして2027年に向けて、時代はどう変わっていくのか。<br>ゆっくり聴いていただけたらうれしいです。</p>
<p>この続きは、11/27の講演会で、村主さんが「時代の構造」から読み解きます。<br>よろしければ、こちらもご覧ください。<br><a href="${SITE}">${SITE}</a></p>
<p>つっちー（結び）</p></div>`, [NOTIFY_TO]);
}

// 決済済みかStripeに確認して、済んでいればDBに記録
async function confirmSession(sessionId) {
  const s = await stripe("GET", "checkout/sessions/" + encodeURIComponent(sessionId));
  if (!s || s.payment_status !== "paid") return false;
  await rpc("adm_mark_paid", { p_session: sessionId });
  await sendArchive(s).catch(() => {});
  return true;
}

// 2人以上（支払い済み）紹介した人が、すでに払っていたら本人分を自動返金
async function runReferralRefunds() {
  const done = [];
  const list = (await rpc("adm_refund_candidates", {})) || [];
  for (const a of list) {
    const legacy = (a.plans || []).includes("11/27 懇親会") || new Date(a.created_at) < new Date("2026-11-03T00:00:00+09:00");
    const disc = a.referral_discount || 0, refunded = a.refunded_amount || 0;
    const ownFull = a.pair ? Math.max(0, person(a.plans || [], a.student, legacy, isEarly(a.created_at)) - 1500) : (a.total || 0) + disc - ((a.plans || []).includes(ARCH) ? ARCH_PRICE : 0);
    const hasPass = (a.plans || []).some((k) => PASSES.includes(k));
    const full = hasPass && a.referred >= 4;
    const target = full ? ownFull : Math.min(lectureValue(a.plans, a.student), ownFull);
    const delta = target - disc - refunded;
    if (delta <= 0 || !a.stripe_session_id) continue;
    const s = await stripe("GET", "checkout/sessions/" + encodeURIComponent(a.stripe_session_id));
    if (!s || !s.payment_intent) continue;
    const refundAmt = Math.min(delta, (s.amount_total || 0) - refunded);
    if (refundAmt <= 0) continue;
    const rf = await stripe("POST", "refunds", { payment_intent: s.payment_intent, amount: String(refundAmt), "metadata[reason]": full ? "referral_free_pass" : "referral_free" });
    if (!rf || !rf.id) continue;
    await rpc("adm_mark_refunded", { p_id: a.id, p_amount: refundAmt, p_refund: rf.id });
    const what = full ? "冬の通し券の参加費" : "11/27 講演会の参加費";
    const after = full ? "（通し券が無料になります）" : "（講演会が無料になります）";
    await sendMail([a.email], "【紹介特典】参加費を返金しました ─ 2027年をどう生きるか",
      `<div style="font-family:sans-serif;line-height:1.9;color:#2a2f3a;max-width:560px"><p>${esc(a.name)} 様</p>
<p>お知り合いを${a.referred}名ご紹介いただき、ありがとうございます。<br>紹介特典として、${what} <b>${yen(refundAmt)}</b> を返金しました${after}。</p>
<p>カード会社によって、返金の反映まで数日〜1か月ほどかかる場合があります。</p>
<p>当日お会いできるのを楽しみにしています。</p><p>つっちー（結び）</p></div>`, [NOTIFY_TO]).catch(() => {});
    done.push({ id: a.id, amount: refundAmt });
  }
  return done;
}

module.exports = { ARCH, ARCH_PRICE, SB, SB_KEY, SITE, PRICES, HALF, LIMITS, PASSES, NEEDS, remaining, isEarly, EARLY_OFF, lectureValue, yen, esc, person, rpc, stripe, sendMail, confirmSession, runReferralRefunds };
