// トップページ（/）に「特別ご招待（無料枠）」リンク ?p=tc27invite を足す
// index.html 本体はそのまま。読み込んだHTMLの一部だけを書き換えて返す（失敗したら元のページをそのまま出す）
export const config = { matcher: "/" };

const REPLACES = [
  [
    "PROMOS={tc27free:{'11/27 講演会':0,'11/27 講演会＋懇親会セット':5000}};",
    "PROMOS={tc27free:{'11/27 講演会':0,'11/27 講演会＋懇親会セット':5000},tc27invite:{'11/27 講演会':0,'11/27 講演会＋懇親会セット':0}},PROMONOTE={tc27free:'特別ご招待：11/27 講演会は会場参加なら無料、懇親会つきセットは5,000円でご参加いただけます（オンラインは通常価格）',tc27invite:'特別ご招待（無料枠）：11/27 講演会・講演会＋懇親会セットとも、会場参加なら無料でご参加いただけます（オンラインは通常価格）'};",
  ],
  [
    "'特別ご招待：11/27 講演会は会場参加なら無料、懇親会つきセットは5,000円でご参加いただけます（オンラインは通常価格）'}}",
    "PROMONOTE[PROMO]}}",
  ],
  [
    "'<b style=\"color:#b8302b\">特別価格 '+",
    "'<b style=\"color:#b8302b\">'+(PROMO==='tc27invite'?'特別ご招待 ':'特別価格 ')+",
  ],
];

export default async function middleware(request) {
  try {
    if (request.method !== "GET") return;
    const r = await fetch(new URL("/index.html", request.url));
    if (!r.ok) return;
    let html = await r.text();
    for (const [a, b] of REPLACES) {
      if (!html.includes(a)) return; // 元のページが変わっていたら何もしない
      html = html.replace(a, b);
    }
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" } });
  } catch (e) {
    return;
  }
}
