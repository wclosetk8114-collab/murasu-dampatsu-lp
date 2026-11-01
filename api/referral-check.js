// 毎日1回（Vercel Cron）：取りこぼした支払いを確認 → 紹介特典の返金チェック
const { rpc, confirmSession, runReferralRefunds } = require("./_lib");
module.exports = async (req, res) => {
  const auth = req.headers.authorization || "";
  if (!process.env.CRON_SECRET || auth !== "Bearer " + process.env.CRON_SECRET) return res.status(401).json({ error: "auth" });
  let confirmed = 0;
  const list = (await rpc("adm_unpaid_sessions", {})) || [];
  for (const r of list) { if (await confirmSession(r.stripe_session_id).catch(() => false)) confirmed++; }
  const refunded = await runReferralRefunds();
  return res.status(200).json({ ok: true, confirmed, refunded });
};
