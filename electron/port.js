const net = require("net")

/**
 * 配布exeのサーバーが優先して使うポート(127.0.0.1)。
 * 画面の設定(サイドバーの折りたたみ・絞り込みなど)はブラウザのlocalStorageに保存され、保存先は
 * オリジン(http://127.0.0.1:<ポート>)ごとに分かれる。起動のたびにポートが変わると、保存済みの設定が
 * 毎回見えなくなるため、できるだけ同じポートで起動する。
 * 49152以降はOSが一時的な接続に割り当てるため避け、Windowsの除外ポート範囲にも入りにくい値にしている。
 */
const PREFERRED_PORT = 38417

/** host:port で待ち受けられるかを確かめ、待ち受けた(閉じた)ポート番号を返す。port=0 なら空いているポートをOSが選ぶ */
function probe(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(port, "127.0.0.1", () => {
      const { port: bound } = server.address()
      server.close(() => resolve(bound))
    })
  })
}

/**
 * 起動に使うポートを決める。優先ポートが空いていればそれを、使用中(別のexeの二重起動・他のアプリ・
 * 終了しきれなかった前回のサーバー等)や権限不足で使えないときだけ、空いているポートを使う。
 * 戻り値の isPreferred が false のときは、この起動の間だけ別のオリジンになり、
 * localStorageに保存した画面の設定は優先ポートで起動したときのものと別扱いになる。
 */
async function pickPort(preferred = PREFERRED_PORT) {
  try {
    return { port: await probe(preferred), isPreferred: true }
  } catch {
    return { port: await probe(0), isPreferred: false }
  }
}

module.exports = { PREFERRED_PORT, pickPort }
