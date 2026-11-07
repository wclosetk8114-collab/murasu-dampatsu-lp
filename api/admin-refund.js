// 事務局用：重複申し込みなどの返金（DBに登録した1回限りのトークンでだけ動く）
const { rpc, stripe } = require("./_lib");
module.exports = async (req, res) => {
  const t = String((req.query && req.query.t) || "").slice(0, 80);
  if (!/^[0-9a-f-]{30,}$/.test(t)) return res.status(400).json({ error: "input" });
  try {
    const r = ((await rpc("adm_take_refund", { p_token: t })) || [])[0];
    if (!r) return res.status(404).json({ error: "notfound" });
    if (r.done) return res.status(200).json({ ok: true, already: true });
    const s = await stripe("GET", "checkout/sessions/" + encodeURIComponent(r.stripe_session_id));
    if (!s || !s.payment_intent || s.payment_status !== "paid") return res.status(409).json({ error: "notpaid" });
    const amt = Math.min(r.amount, s.amount_total || 0);
    const rr = await fetch("https://api.stripe.com/v1/refunds", { method: "POST", headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ payment_intent: s.payment_intent, amount: String(amt), "metadata[reason]": "duplicate" }).toString() });
    const rf = await rr.json().catch(() => ({}));
    if (!rr.ok || !rf.id) return res.status(502).json({ error: "refund", code: rf.error && (rf.error.code || rf.error.type), msg: rf.error && String(rf.error.message || "").replace(/(sk|rk)_[A-Za-z0-9_*]+/g, "***") });
    await rpc("adm_done_refund", { p_token: t, p_refund: rf.id });
    return res.status(200).json({ ok: true, amount: amt, name: r.name, status: rf.status });
  } catch (e) { return res.status(500).json({ error: "server" }); }
};
