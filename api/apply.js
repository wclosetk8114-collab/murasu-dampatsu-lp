const { rpc, PRICES, HALF, LIMITS, PASSES, NEEDS, remaining, person, isEarly, EARLY_OFF, lectureValue } = require("./_lib");
// 申し込み受付：Supabaseに保存 → 確認メール送信（RESEND_API_KEY があるとき）
const SB_URL = "https://cczerefroeveoobdlhoj.supabase.co/rest/v1/event_applications";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjemVyZWZyb2V2ZW9vYmRsaG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4OTg1NjYsImV4cCI6MjEwMzQ3NDU2Nn0.KsQtf2gYD5EOFYB9Jq-uH8pHI1dVIrUH99J0qkUJy54";
const MAIL_FROM = process.env.MAIL_FROM || "村主悠真×つっちー 講演会事務局 <hello@musubi-kakeizu.com>";
const NOTIFY_TO = process.env.NOTIFY_TO || "w.closet.k8114@gmail.com";
const REPLY_TO = process.env.REPLY_TO || "kyoten.zimukyoku@gmail.com";
const ZOOM_1104 = "https://us06web.zoom.us/j/81711000222?pwd=lUX2jfPKkPvRgav3HQfdDtWaMmBuja.1";
const LABEL = {
  "11/4 オンライン対談": "11/4（水）20:00〜 オンライン対談【オンライン参加・Zoom】",
  "11/27 講演会": "11/27（金）講演会のみ【会場参加・東京都内】",
  "11/27 講演会（オンライン）": "11/27（金）講演会のみ【オンライン参加】",
  "11/27 講演会＋懇親会セット": "11/27（金）講演会＋懇親会セット【会場参加・東京都内】",
  "12/21 虚点": "12/21（月）虚点【会場参加・東京都内】",
  "12/21 虚点（オンライン）": "12/21（月）虚点【オンライン参加】",
  "冬の通し券（会場）": "冬の通し券：11/27 講演会＋懇親会 ＋ 12/21 虚点【会場参加・東京都内】",
  "冬の通し券 ライト（会場）": "冬の通し券 ライト：11/27 講演会 ＋ 12/21 虚点【会場参加・東京都内】",
  "冬の通し券 ライト（オンライン）": "冬の通し券 ライト：11/27 講演会 ＋ 12/21 虚点【オンライン参加】",
};
const lab = (p) => LABEL[p] || p;
const OPENCHAT = "https://line.me/ti/g2/A6vHp2wI6sO00NYHovnl-rYSg7fXp-voM7pEjQ";
const SITE = "https://murasu-dampatsu-lp.vercel.app";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const s = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const yen = (n) => n.toLocaleString("ja-JP") + "円";

function calc(plans, pair, stu, pstu, free) {
  const set = plans.includes("11/27 講演会＋懇親会セット");
  const early = isEarly();
  const a = Math.max(0, person(plans, stu, false, early) - (free ? lectureValue(plans, stu) : 0));
  if (!pair) return { total: a, set };
  const b = person(plans, pstu, false, early);
  return { total: Math.max(0, a - 1500) + Math.max(0, b - 1500), set };
}

async function checkout(key, { total, name, email, plans, pair, id }) {
  const f = new URLSearchParams();
  f.append("mode", "payment");
  f.append("locale", "ja");
  f.append("customer_email", email);
  f.append("success_url", SITE + "/?paid=1&session_id={CHECKOUT_SESSION_ID}#apply");
  f.append("cancel_url", SITE + "/?cancel=1#apply");
  f.append("expires_at", String(Math.floor(Date.now() / 1000) + 31 * 60));
  f.append("line_items[0][quantity]", "1");
  f.append("line_items[0][price_data][currency]", "jpy");
  f.append("line_items[0][price_data][unit_amount]", String(total));
  f.append("line_items[0][price_data][product_data][name]", "2027年をどう生きるか ─ 村主悠真×つっちー" + (pair ? "（2名）" : ""));
  f.append("line_items[0][price_data][product_data][description]", plans.map(lab).join(" / "));
  f.append("metadata[name]", name);
  f.append("metadata[plans]", plans.map(lab).join(" / "));
  f.append("metadata[pair]", pair ? "yes" : "no");
  f.append("metadata[app_ref]", id);
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("stripe error", r.status, j.error && j.error.message); return { _err: (j.error && (j.error.code || j.error.type)) || String(r.status), _msg: j.error && j.error.message ? String(j.error.message).replace(/sk_[a-z]+_[A-Za-z0-9*]+/g, "sk_***") : "" }; }
  return j;
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
  if (plans.filter((p) => PASSES.includes(p)).length > 1) return res.status(400).json({ error: "input" });
  if (plans.some((p) => PASSES.includes(p)) && plans.some((p) => p.startsWith("11/27") || p.startsWith("12/21"))) return res.status(400).json({ error: "input" });
  if (plans.filter((p) => p.startsWith("11/27")).length > 1) return res.status(400).json({ error: "input" });
  if (plans.filter((p) => p.startsWith("12/21")).length > 1) return res.status(400).json({ error: "input" });
  const student = !!b.student, pair_student = pair && !!b.pair_student;
  // 定員チェック（セット30名・虚点会場20名）
  const need = pair ? 2 : 1;
  try {
    const rem = await remaining();
    const full = plans.filter((p) => (NEEDS[p] || []).some((k) => rem[k] < need));
    if (full.length) return res.status(409).json({ error: "full", plans: full, remaining: rem });
  } catch {}
  // 紹介特典：支払い済みの人を2人以上紹介した人は11/27講演会が無料（ページには書かない）
  let free = false;
  try { free = lectureValue(plans, student) > 0 && (await rpc("adm_paid_referral_count", { p_name: name })) >= 2; } catch {}
  const { total, set } = calc(plans, pair, student, pair_student, free);

  // 有料ならStripeの決済画面をつくる（STRIPE_SECRET_KEY があるとき）
  let session = null;
  const skey = process.env.STRIPE_SECRET_KEY;
  if (skey && total > 0) {
    session = await checkout(skey, { total, name, email, plans, pair, id: Date.now().toString(36) });
    if (!session || session._err) return res.status(502).json({ error: "stripe", code: session && session._err, detail: session && session._msg });
  }

  const row = { event_key: "murasu-2026winter", name, email, plans, pair, pair_name: pair_name || null, pair_email: pair_email || null,
    referrer: referrer || null, ref_code: ref_code || null, message: message || null, total, student, pair_student, free_by_referral: free, stripe_session_id: session ? session.id : null };
  const ins = await fetch(SB_URL, { method: "POST", headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(row) });
  if (!ins.ok) return res.status(500).json({ error: "save" });

  const key = (process.env.RESEND_API_KEY || process.env.resend);
  let mailed = false;
  if (key) {
    const list = plans.map((p) => `<li>${esc(lab(p))}（${PRICES[p] ? yen(student && HALF.includes(p) ? PRICES[p] / 2 : PRICES[p]) : "無料"}）</li>`).join("");
    const early = isEarly() && plans.some((p) => p.startsWith("11/27"));
    const extra = [free ? "紹介特典（11/27 講演会 無料）" : "", early ? "早割（11/27 1人1,000円オフ）" : "", student ? "学生半額" : "", pair_student ? "同伴者 学生半額" : "", pair ? "ペア割（1人1,500円オフ）" : ""].filter(Boolean).join("／");
    const body = `<div style="font-family:sans-serif;line-height:1.9;color:#2a2f3a;max-width:560px">
<p>${esc(name)} 様</p>
<p>「2027年をどう生きるか ─ 村主悠真 × つっちー」にお申し込みいただき、ありがとうございます。<br>以下の内容で受け付けました。</p>
<div style="border:1px solid #d8cdb6;padding:16px 20px;margin:16px 0">
<b>参加する回</b><ul style="margin:6px 0 10px">${list}</ul>
${pair ? `<b>一緒に参加する方</b><br>${esc(pair_name)} 様<br><br>` : ""}
${referrer ? `<b>紹介者</b><br>${esc(referrer)}<br><br>` : ""}
<b>合計</b>：${yen(total)}${pair ? "（2人分）" : ""}${extra ? `<br><small>${extra} 適用</small>` : ""}
</div>
${session ? `<p><b>お支払いについて</b><br>お申し込みのあと表示されたカード決済の画面でお支払いください。まだお済みでない場合は、下のリンクから24時間以内にお支払いいただけます。<br><a href="${session.url}">お支払いページを開く</a></p>` : ""}<p>会場の詳細は、あらためてご連絡します。（11/27・12/21はどちらも18:00〜21:00）</p>
${plans.includes("11/4 オンライン対談") ? `<div style="border:2px solid #2d8cff;background:#f2f8ff;padding:16px 20px;margin:16px 0">
<b>11/4（水）20:00〜 オンライン対談の参加URL（Zoom）</b><br>
当日はこちらから入室してください。<br>
<a href="${ZOOM_1104}" style="display:inline-block;margin-top:10px;background:#2d8cff;color:#fff;text-decoration:none;padding:10px 22px;border-radius:2px">Zoomに参加する</a><br>
<small>${ZOOM_1104}</small><br>
<small>ミーティングID：817 1100 0222</small>
</div>` : ""}
<div style="border:1px solid #06c755;background:#f3fcf6;padding:16px 20px;margin:16px 0">
<b>LINEオープンチャットにご参加ください</b><br>
「村主悠真×つっちー｜11/4 20時〜オンライン｜11/27夜 講演会＆懇親会｜12/21夜 虚点」<br>
会場・時間のお知らせ、当日の案内はこちらで発信します。<br>
<a href="${OPENCHAT}" style="display:inline-block;margin-top:10px;background:#06c755;color:#fff;text-decoration:none;padding:10px 22px;border-radius:2px">オープンチャットに参加する</a><br>
<small>${OPENCHAT}</small>
</div>
<div style="border:1px solid #d8cdb6;padding:16px 20px;margin:16px 0">
<b>■ 村主悠真 各種プロジェクト</b><br>
当日までに見ておくと、お話の理解がぐっと深まるのでおすすめです。<br>今のあなたに響く入口から、村主悠真の世界に触れてみてください。
<ol style="margin:8px 0 0;padding-left:1.4em"><li style="margin:6px 0">Λ瞑想・θ回廊などの村主悠真関連PJ告知用ΩLINE<br><a href="https://index.yuma-muranushi.jp/line/open/BeSzTQHJdaun">https://index.yuma-muranushi.jp/line/open/BeSzTQHJdaun</a></li><li style="margin:6px 0">虚点・講演会公式LINE（村主プロジェクト診断や全国の開催情報を配信中）<br><a href="https://lin.ee/PJS8mvNW">https://lin.ee/PJS8mvNW</a></li><li style="margin:6px 0">村主悠真公式YouTubeチャンネル<br><a href="https://youtu.be/A8_ahHcLG1Y?si=hSzRYUt3I7mxv4r5">https://youtu.be/A8_ahHcLG1Y?si=hSzRYUt3I7mxv4r5</a></li><li style="margin:6px 0">虚次元メディア『視座プラス』（構造視力を養うメディア）<br><a href="https://iii-iii.com/i.media/">https://iii-iii.com/i.media/</a></li><li style="margin:6px 0">村主悠真論文サイト（虚数拡張理論を基に論文を更新中）<br><a href="https://iii-iii.com/i.fragmenta/">https://iii-iii.com/i.fragmenta/</a></li><li style="margin:6px 0">iPeace（世界平和ブランド）<br><a href="https://iii-iii.com/i.peace/">https://iii-iii.com/i.peace/</a></li></ol>
</div>
<p>イベントページ：<a href="${SITE}">${SITE}</a></p>
<p>ご不明な点は、このメールにそのまま返信してください。</p>
<p>つっちー（結び）</p></div>`;
    const kinds = [...new Set(plans.map((p) => lab(p).match(/【(.+?)】/)[1].replace(/・.*/, "")))].join("・");
    const subject = `【お申し込み受付】2027年をどう生きるか ─ 村主悠真 × つっちー（${kinds}）`;
    const to = pair ? [email, pair_email] : [email];
    try { mailed = await sendMail(key, to, subject, body, [NOTIFY_TO]); } catch { mailed = false; }
    // 11/4 オンライン対談の申し込み者に、Zoom案内メールを別送（11/3までは「明日」、11/4当日は「今日」。11/5以降は送らない）
    if (plans.includes("11/4 オンライン対談")) {
      const jst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      if (jst <= "2026-11-04") {
        const D = jst === "2026-11-04" ? "今日" : "明日";
        const zsub = `【${D}20時〜】村主悠真 × つっちー オンライン対談のご案内（Zoom URL）`;
        const zbody = `<div style="font-family:sans-serif;line-height:1.9;color:#2a2f3a;max-width:560px">
<p>こんにちは、つっちーです。</p>
<p>このたびは「2027年をどう生きるか ─ 村主悠真 × つっちー」オンライン対談にお申し込みいただき、本当にありがとうございます。</p>
<p>いよいよ${D}、冬の講演シリーズがスタートします。<br>村主さんがどんな人生を歩み、いま何を見ているのか。そして2027年に向けて、時代はどう変わっていくのか。<br>私自身、聴きたいことがたくさんあって、今からとても楽しみにしています。</p>
<p>当日の参加方法をお送りしますね。</p>
<p>━━━━━━━━━━<br>■ 日時<br>2026年11月4日（水）20:00〜</p>
<p>■ 参加URL（Zoom）<br><a href="${ZOOM_1104}">${ZOOM_1104}</a><br>ミーティングID：817 1100 0222<br>━━━━━━━━━━</p>
<p>お時間になりましたら、上のURLから気軽に入ってください。<br>カメラのオン・オフは自由です。お茶でも飲みながら、リラックスしてご参加いただけたらうれしいです。</p>
<p>当日ご都合が合わなくなった方も、あとからアーカイブでご覧いただけます。<br>ただ、その場でしか生まれない空気や質問のやりとりもあるので、ぜひリアルタイムでお会いできたらうれしいです。</p>
<p>★ 11/27の講演会の早割は、11/6（金）23:59まで<br>講演会・セットが1,000円オフになります。<br>対談を聴いて「もっと深く聴いてみたい」と思ったら、ぜひこちらもご覧ください。<br><a href="${SITE}">${SITE}</a></p>
<p>${D === "今日" ? "今夜" : "明日の夜"}、画面越しにお会いできるのを心から楽しみにしています。</p>
<p>つっちー</p></div>`;
        try { await sendMail(key, pair ? [email, pair_email] : [email], zsub, zbody); } catch {}
      }
    }
    // 紹介経由の申し込みは、事務局あてに別途お知らせ（件名で紹介者がわかる）
    const refBy = ref_code || referrer;
    if (refBy) {
      const note = `<div style="font-family:sans-serif;line-height:1.8;color:#2a2f3a"><p><b>紹介経由の申し込みがありました</b></p>
<p>紹介者：${esc(refBy)}${ref_code ? "（専用リンク経由）" : "（フォームに記入）"}<br>申し込み者：${esc(name)} 様（${esc(email)}）<br>${pair ? `同伴者：${esc(pair_name)} 様<br>` : ""}参加する回：<br>${plans.map((p) => "・" + esc(lab(p))).join("<br>")}<br>合計：${yen(total)}${session ? "（カード決済待ち→支払い後に確定）" : ""}</p></div>`;
      try { await sendMail(key, [NOTIFY_TO], `【紹介：${refBy}】${name}様が申し込みました（${[...new Set(plans.map((p) => lab(p).match(/【(.+?)】/)[1].replace(/・.*/, "")))].join("・")}）`, note); } catch {}
    }
  }
  return res.status(200).json({ ok: true, mailed, checkout_url: session ? session.url : null });
};
