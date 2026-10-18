/**
 * 起動の通知。優先ポートが使えず、別のポートで起動したときだけ、画面の上部に帯を1回出すための情報。
 * electron に依存しない純粋な関数だけを置く（main.js が使う）。
 *
 * ポートが変わると、画面の設定（サイドバーの折りたたみ・絞り込みなど。ブラウザの localStorage に保存され、保存先は
 * オリジン＝ポートごとに分かれる）が、通常の起動とは別扱いになる。その旨を知らせる。
 */

/** 優先ポートが使えなかったときだけ通知を作る。優先ポートで起動できたときは null */
function portFallbackNotice({ port, isPreferred, preferredPort }) {
  return isPreferred ? null : { kind: "port-fallback", port, preferredPort }
}

/**
 * 通知を1つだけ持つ入れ物。take() で渡すと空になる（画面を再読み込みしても、同じ起動の間に2回は出さない）。
 */
function createNoticeSlot() {
  let notice = null
  return {
    set(next) {
      notice = next
    },
    take() {
      const current = notice
      notice = null
      return current
    },
  }
}

module.exports = { portFallbackNotice, createNoticeSlot }
