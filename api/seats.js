// 残り枠（セット30名・虚点会場20名）
const { remaining } = require("./_lib");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { return res.status(200).json({ ok: true, remaining: await remaining() }); }
  catch (e) { return res.status(200).json({ ok: false }); }
};
