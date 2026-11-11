// 毎朝9時（Vercel Cron）：申し込み状況を公式LINEでつっちーに報告（LINEの設定がまだならメールで報告）
const { rpc, sendMail, remaining, SITE } = require("./_lib");
const n = (rows, plan, k = "confirmed") => ((rows.find((r) => r.plan === plan) || {})[k]) || 0;
const yen = (v) => Number(v).toLocaleString("ja-JP") + "円";

function buildText(s, rem) {
  const r = s.plans || [];
  const pv = n(r, "冬の通し券（会場）"), plv = n(r, "冬の通し券 ライト（会場）"), plo = n(r, "冬の通し券 ライト（オンライン）");
  const npass = n(r, "冬の通し券（会場）", "new24") + n(r, "冬の通し券 ライト（会場）", "new24") + n(r, "冬の通し券 ライト（オンライン）", "new24");
  const setN = n(r, "11/27 講演会＋懇親会セット") + pv, lecV = n(r, "11/27 講演会") + plv, lecO = n(r, "11/27 講演会（オンライン）") + plo;
  const kyV = n(r, "12/21 虚点") + pv + plv, kyO = n(r, "12/21 虚点（オンライン）") + plo;
  const new1127 = n(r, "11/27 講演会＋懇親会セット", "new24") + n(r, "11/27 講演会", "new24") + n(r, "11/27 講演会（オンライン）", "new24") + npass;
  const new1221 = n(r, "12/21 虚点", "new24") + n(r, "12/21 虚点（オンライン）", "new24") + npass;
  const unpaid = r.reduce((a, x) => a + (x.unpaid || 0), 0);
  const d = new Date(Date.now() + 9 * 3600e3);
  const lines = [
    `【申し込み状況】${d.getUTCMonth() + 1}/${d.getUTCDate()} 朝の報告`,
    ``,
    `■ 11/27 講演会　合計 ${setN + lecV + lecO}名（前日比 +${new1127}）`,
    `・セット（会場）${setN}名　残り${rem["11/27 講演会＋懇親会セット"]}席`,
    `・講演会のみ 会場 ${lecV}名`,
    `・講演会のみ オンライン ${lecO}名`,
    `→ 会場 ${setN + lecV}名／懇親会 ${setN}名`,
    ``,
    `■ 12/21 虚点　合計 ${kyV + kyO}名（前日比 +${new1221}）`,
    `・会場 ${kyV}名　残り${rem["12/21 虚点"]}席`,
    `・オンライン ${kyO}名`,
    ``,
    `■ 冬の通し券　合計 ${pv + plv + plo}名（上の人数に含む）`,
    `・通し券（会場）${pv}名／ライト 会場 ${plv}名／ライト オンライン ${plo}名`,
    ``,
    `■ 11/4 オンライン対談　${n(r, "11/4 オンライン対談")}名`,
    `■ アーカイブのみ　11/27 ${n(r, "11/27 講演会（アーカイブのみ）")}名／12/21 ${n(r, "12/21 虚点（アーカイブのみ）")}名`,
    `■ 11/4 対談アーカイブ販売　${n(r, "11/4 対談アーカイブ")}名（前日比 +${n(r, "11/4 対談アーカイブ", "new24")}）`,
    ``,
    `売上（返金を引いた額）：${yen(s.revenue || 0)}`,
    unpaid ? `※ 決済が済んでいない人：${unpaid}名` : ``,
    ``,
    SITE,
  ];
  return lines.filter((l, i) => l !== `` || lines[i - 1] !== ``).join("\n").trim();
}

module.exports = async (req, res) => {
  const auth = req.headers.authorization || "";
  const okCron = process.env.CRON_SECRET && auth === "Bearer " + process.env.CRON_SECRET;
  const okKey = process.env.ADMIN_SECRET && req.query && req.query.key === process.env.ADMIN_SECRET;
  if (!okCron && !okKey) return res.status(401).json({ error: "auth" });
  const s = await rpc("adm_daily_summary", {});
  const rem = await remaining();
  const text = buildText(s, rem);
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN, to = process.env.LINE_USER_ID;
  let via = "none";
  if (token && to) {
    const r = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
    });
    via = r.ok ? "line" : "line_error_" + r.status;
  }
  if (via !== "line") {
    const ok = await sendMail([process.env.NOTIFY_TO || "w.closet.k8114@gmail.com"], "【毎朝の報告】村主悠真×つっちー 申し込み状況",
      `<pre style="font-family:sans-serif;font-size:14px;line-height:1.8;white-space:pre-wrap">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</pre>`).catch(() => false);
    via = via + (ok ? "+mail" : "+mail_error");
  }
  return res.status(200).json({ ok: true, via, text });
};
