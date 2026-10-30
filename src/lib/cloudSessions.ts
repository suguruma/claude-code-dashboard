/**
 * クラウドのセッション(⑬ CL-1)。中身(状態・指示と報告)は claude.ai のログインの鍵が要るので、Dashboard には出さない。
 * ボタンで claude.ai のクラウドのセッションのページを開くだけにする。
 * exe では、このURLを electron/externalUrl.js の許可リストに完全一致で入れ、既定のブラウザで開く(窓の中では開かない)。
 */
export const CLOUD_SESSIONS_URL = "https://claude.ai/code"

/** ボタンの横に出す1行 */
export const CLOUD_SESSIONS_NOTE = "クラウドのセッションの中身は、Dashboard では見られません（ログインの鍵を読まないため）"
