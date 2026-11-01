// 決済完了後にページから呼ばれる：支払いを確認 → 紹介特典の返金チェック
const { confirmSession, runReferralRefunds } = require("./_lib");
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  const sid = b && typeof b.session_id === "string" ? b.session_id.slice(0, 200) : "";
  if (!/^cs_/.test(sid)) return res.status(400).json({ error: "input" });
  try {
    const paid = await confirmSession(sid);
    if (paid) await runReferralRefunds();
    return res.status(200).json({ ok: true, paid });
  } catch (e) { return res.status(200).json({ ok: false }); }
};
