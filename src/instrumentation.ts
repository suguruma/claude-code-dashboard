/**
 * Next のサーバーの起動時に1回だけ呼ばれる。スマホから読み取り専用で見る(⑪)の LAN の入り口を用意し、
 * 一覧と利用上限の台帳の暖機(⑫ ST-10)を裏で始める(待たない。`/api/health` の答えを遅らせない)。
 * 入り口は、設定でオンにしたときだけ LAN で待ち受ける(既定はオフ。オフのあいだは、設定のファイルを数秒ごとに読むだけ)。
 * 開発(next dev・next start)と exe(standalone の server.js)で同じ仕組みが動く。
 * 読み込みは `NEXT_RUNTIME === "nodejs"` の if の中に置く(Next の決まった書き方)。早めに return する書き方だと、
 * 開発のサーバーが Edge 用にも fs を含む入り口をコンパイルして失敗し、すべての要求が 500 になるため
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // ビルドの途中では動かさない(オンのままビルドしても、入り口を開かない)
    if (process.env.NEXT_PHASE === "phase-production-build") return
    const { startLanGateway } = await import("./lib/lanAccess/gateway")
    startLanGateway()
    void import("./lib/startupWarmup").then(({ warmUp }) => warmUp()).catch(() => {})
  }
}
