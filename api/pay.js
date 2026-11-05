// メールの「お支払いページを開く」ボタン：期限切れでも、その場で新しい決済画面をつくって開く
const { rpc, stripe, confirmSession, SITE } = require("./_lib");
module.exports = async (req, res) => {
  const t = String((req.query && req.query.t) || "").slice(0, 80);
  const go = (u) => { res.statusCode = 302; res.setHeader("Location", u); res.setHeader("Cache-Control", "no-store"); res.end(); };
  if (!/^[0-9a-f-]{20,}$/.test(t)) return go(SITE + "/#apply");
  try {
    const rows = await rpc("adm_pay_info", { p_token: t });
    const a = rows && rows[0];
    if (!a || !a.total || !a.stripe_session_id) return go(SITE + "/#apply");
    if (a.paid) return go(SITE + "/?paid=1#apply");
    const s = await stripe("GET", "checkout/sessions/" + encodeURIComponent(a.stripe_session_id));
    if (s && s.payment_status === "paid") { await confirmSession(s.id); return go(SITE + "/?paid=1&session_id=" + s.id + "#apply"); }
    if (s && s.status === "open" && s.url) return go(s.url);
    const m = (s && s.metadata) || {};
    const f = { mode: "payment", locale: "ja", customer_email: a.email,
      success_url: SITE + "/?paid=1&session_id={CHECKOUT_SESSION_ID}#apply", cancel_url: SITE + "/?cancel=1#apply",
      expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
      "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "jpy",
      "line_items[0][price_data][unit_amount]": String(a.total),
      "line_items[0][price_data][product_data][name]": "2027年をどう生きるか ─ 村主悠真×つっちー" + (a.pair ? "（2名）" : ""),
      "line_items[0][price_data][product_data][description]": m.plans || (a.plans || []).join(" / ") };
    for (const k of Object.keys(m)) if (k !== "archive_sent") f["metadata[" + k + "]"] = m[k];
    if (!m.name) f["metadata[name]"] = a.name;
    const n = await stripe("POST", "checkout/sessions", f);
    if (!n || !n.url) return go(SITE + "/#apply");
    await rpc("adm_replace_session", { p_old: a.stripe_session_id, p_new: n.id });
    return go(n.url);
  } catch (e) { return go(SITE + "/#apply"); }
};
