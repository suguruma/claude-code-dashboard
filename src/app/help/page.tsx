import Link from "next/link"
import {
  Activity,
  ArrowLeftRight,
  BrainCircuit,
  Home,
  LineChart,
  ListChecks,
  ListTodo,
  Settings as SettingsIcon,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const SECTIONS = [
  { id: "about", label: "このダッシュボードとは" },
  { id: "concept", label: "基本的な考え方" },
  { id: "glossary", label: "用語集" },
  { id: "pages", label: "各ページの使い方" },
  { id: "faq", label: "困ったときは" },
] as const

const GLOSSARY: { term: string; description: string }[] = [
  {
    term: "CLAUDE.md",
    description:
      "Claude Codeが自動的に読み込む基本ルールファイル。プロジェクト直下や ~/.claude に置く。本ダッシュボードでは「## 見出し」ごとに1つの「ルール」として扱う。",
  },
  {
    term: "ルール",
    description:
      "CLAUDE.md内の「## 見出し」ひとつひとつのこと。有効/無効を切り替えられる。無効化してもコメントアウトされるだけで文章自体は削除されない。",
  },
  {
    term: "スキル（SKILL.md）",
    description:
      ".claude/skills/<名前>/SKILL.md に定義された、Claude Codeが呼び出せる定型の作業手順やプロンプトテンプレート。",
  },
  {
    term: "実行ログ（execution_log.json）",
    description:
      "タスク完了時に記録される、AIエージェント間の議論・手戻り理由・次回用プロンプト等をまとめた時系列ログ。ダッシュボード自身は生成せず、Claude Code側のスキル（autonomous-production-teamまたはsession-log-extractor）が書き出す。",
  },
  {
    term: "1-Shot達成度",
    description: "1回の指示だけでどれだけ完成度の高い成果物を出せたかを示すスコア。手戻り（介入）が少ないほど高くなる。",
  },
  {
    term: "次回用プロンプト",
    description: "「最初からこう頼んでいれば一発で完了していた」という、次回用に最適化された指示文。",
  },
  {
    term: "セッション",
    description:
      "Claude Codeとの一連のやり取り1回分。 ~/.claude/projects/<プロジェクト>/<セッションID>.jsonl というファイルに記録される。",
  },
  {
    term: "トークン",
    description: "LLMがテキストを処理する際の最小単位。会話が長くなるほど消費量が増え、コストや応答速度に影響する。",
  },
  {
    term: "コンパクション（コンテキスト圧縮）",
    description:
      "会話が長くなりすぎたときにClaude Codeが自動で過去の内容を要約する処理。頻発している場合はルールを忘れ始めているサインかもしれない。",
  },
  {
    term: "サブエージェント",
    description: "メインのClaude Codeが専門的な作業を別のエージェントに委任する仕組み。",
  },
  {
    term: "フック（hooks）",
    description: "ツール実行の前後など、特定のタイミングでカスタムコマンドを自動実行する仕組み。",
  },
  {
    term: "CPUモード",
    description:
      "本ダッシュボードの動作モード。ファイルの読み書きのみで外部通信を行わない。ローカルLLMと接続する「GPUモード」構想は方針転換により廃止し、ルールの矛盾・重複整理はClaude Code標準スキル「rule-optimizer」との連携（ルール整理ページ）に統一した。",
  },
  {
    term: "グローバル設定",
    description: "~/.claude 配下にある、全プロジェクト共通のClaude Code設定。",
  },
  {
    term: "分析対象プロジェクト",
    description:
      "「実行ログ」「ルール整理」ページ内にある独自のプロジェクトセレクター。execution_log.json / rule_refactor_proposal.jsonは、スキルを実際に実行した作業ディレクトリに書き出されるため、TopBar右上の「選択中プロジェクト」（設定管理の対象）とは別に、見たいプロジェクトをこのセレクターで選ぶ。",
  },
  {
    term: "メモリ",
    description: "Claude Codeのセッションが自動的に蓄積する「学んだこと」の記録（ユーザーの好み、プロジェクトの事情等）。",
  },
  {
    term: "バックアップ",
    description: "設定ファイルが上書きされる前に自動保存される過去バージョン。",
  },
]

interface PageGuide {
  href: string
  label: string
  icon: LucideIcon
  description: string
}

const PAGE_GUIDES: PageGuide[] = [
  {
    href: "/",
    label: "ホーム",
    icon: Home,
    description:
      "選択中プロジェクトの概要（有効ルール数・登録スキル数・記録済みタスク数・直近の1-Shot達成度）と、よく使う機能へのショートカット。まずはここでプロジェクトの状態を把握する。",
  },
  {
    href: "/rules",
    label: "ルール管理",
    icon: ListChecks,
    description:
      "CLAUDE.mdの各見出しをカードで表示。トグルで有効/無効を切り替えられ、無効化しても文章はコメントアウトされるだけで消えない。カード見出しの文字列がそのままCLAUDE.mdの「## 見出し」になっている。",
  },
  {
    href: "/skills",
    label: "スキル管理",
    icon: Sparkles,
    description:
      "SKILL.mdの一覧・作成・編集・削除・改名。スキル名（ディレクトリ名）は半角英数字・ハイフン・アンダースコアのみ使用できる。frontmatterのcategoryに応じて表示上グルーピングされる（実ファイルはフラット配置のまま）。references/scripts/evalsサブフォルダがあるスキルにはバッジが付く。対象モデル（frontmatterのtarget-model、自由入力）を記録でき、一覧に🎯バッジで表示される。",
  },
  {
    href: "/settings",
    label: "設定",
    icon: SettingsIcon,
    description:
      "settings.json（権限モード・環境変数・statusLine）、バックアップ履歴、ブロック済みプラグインをタブで閲覧できる。すべて読み取り専用。",
  },
  {
    href: "/trace",
    label: "実行ログ",
    icon: Activity,
    description:
      "execution_log.jsonを可視化。エージェント間の合意度メーター、トレードオフ比較、ユーザー介入ハイライト（赤色）、次回用プロンプトのワンクリック保存ができる。execution_log.json自体は、Claude Codeのターミナルでautonomous-production-team（5役体制の高負荷タスク向け）またはsession-log-extractor（通常の会話を事後的に記録）のいずれかのスキルを実行しないと生成されない。ページ上部の「分析対象プロジェクト」セレクターはTopBarの選択中プロジェクトとは独立しており、ルール保存先（CLAUDE.md）はTopBar側になる。",
  },
  {
    href: "/session-monitor",
    label: "セッション監視",
    icon: LineChart,
    description:
      "実際のClaude Codeのセッション（.jsonl）を解析し、「このセッションが健全か」「次に何をすべきか」を8つの観点（セッションの寿命／無限ループの兆候／読み取りの精度／コストと応答速度／ワークフローの安定性／作業の分業／MCPの稼働／お任せ度）で診断する。各観点は良好・注意・要対処のいずれかで判定され、問題があれば具体的な対処（/clearでのリセット、grepでの読み取り範囲の限定など）が提示される。判定の妥当性を自分で確かめられるよう、各観点を開くと根拠と判定基準（しきい値）も確認できる。数値の多い少ないは単独では判断できないため、同じプロジェクトの過去セッションを古い順に並べたグラフで比較でき、選択中のセッションだけが濃い棒で強調される。セッション一覧には先頭発話の抜粋と発火したスキル名を表示し、どのやりとりだったか一目で判別できる。Claude Codeのターミナルで「session-diagnostician」スキルを実行すると、要求の誤解や手戻りの繰り返しといった、しきい値だけでは分からない意味的な診断（AI診断）も並べて表示される。生の集計値と個別グラフは「詳細データ」を開くと従来どおり確認できる（初期表示を軽くするため、開いたときだけ取得する）。",
  },
  {
    href: "/tasks",
    label: "タスク履歴",
    icon: ListTodo,
    description: "TaskCreate/TaskUpdateツールが記録したタスクリストを、セッション別に進捗バー付きで表示する。",
  },
  {
    href: "/memory",
    label: "メモリ管理",
    icon: BrainCircuit,
    description:
      "Claude Codeが自動的に蓄積したメモリ（AIの記憶）をtype別（user/feedback/project/reference）に閲覧できる。",
  },
  {
    href: "/migrate",
    label: "移行",
    icon: ArrowLeftRight,
    description:
      "ルール・スキルを1つのJSONファイルとしてエクスポートし、別のPC（プロジェクト）に差分プレビュー付きでインポートできる。上書きされるファイルは適用前に自動でバックアップされる。",
  },
  {
    href: "/refactor",
    label: "ルール整理",
    icon: Wand2,
    description:
      "Claude Code標準スキル「rule-optimizer」（execution_log.jsonの過去のユーザー介入履歴から矛盾・重複ルールを学習するスキル）が出力する提案（rule_refactor_proposal.json）をDiffプレビューし、選択した項目だけをCLAUDE.mdへ適用できる。実行自体はClaude Codeのターミナルで行う。ページ上部の「分析対象プロジェクト」セレクターはTopBarの選択中プロジェクトとは独立しており、適用先のCLAUDE.mdもこのセレクターで選んだプロジェクトのものになる。",
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: "「プロジェクトが未登録です」と表示される",
    a: "画面右上の「+」からプロジェクトを登録してください。フォルダをツリーで辿って選べます。登録名やパスを間違えた場合は、選択中プロジェクトの右隣の鉛筆アイコンから編集・登録解除ができます（実際のフォルダは削除されません）。",
  },
  {
    q: "セッション監視で「セッションログが見つかりません」と表示される",
    a: "セッション監視は、登録したプロジェクトではなくこのマシンの ~/.claude/projects/ を直接見ます。Claude Codeを一度も実行していないマシンでは何も表示されません。",
  },
  {
    q: "メモリ管理で「対象なし」と表示される",
    a: "サンプルプロジェクトには projects/ フォルダがありません。画面右上のプロジェクトスイッチャーで実際の ~/.claude（グローバル設定）に切り替えてください。",
  },
  {
    q: "実際の ~/.claude を編集しても大丈夫？",
    a: "ルールのトグル・追加/編集/削除、移行のインポート適用は、選択中プロジェクトの本物のファイルに直接反映されます。まずはサンプルプロジェクトで試すことをおすすめします。",
  },
  {
    q: "ダークモードにならない",
    a: "画面右上のテーマ切替ボタン（太陽・月アイコン）から、ライト・ダーク・システムに合わせるを選べます。",
  },
  {
    q: "「ルール整理」ページで提案が表示されない",
    a: "Claude Codeのターミナルで /rule-optimizer を実行するとrule_refactor_proposal.jsonが生成され、ここに表示される。実行前は「まだ提案がありません」と表示されるのが正常な状態。同スキルはexecution_log.jsonの過去のユーザー介入履歴から学習するため、実行回数が少ないうちは提案が出ない、または少ないことがある。",
  },
  {
    q: "エージェント構成のカードに「役割・制約」「記憶・文脈」などが一部しか出ない",
    a: "これらはエージェントが保持する4種の情報（役割・制約／記憶・文脈／ツール・実行権限／状態）の一部で、いずれも任意項目です。ログにその情報が書かれていれば表示され、書かれていなければその行ごと表示されません。",
  },
  {
    q: "「実行ログ」に何も表示されない",
    a: "execution_log.jsonはこのダッシュボードが自動生成するものではなく、Claude Code側のスキルが書き出す。5役体制で重いタスクを頼むならautonomous-production-team、それ以外の普段の会話を事後的に記録したいだけならsession-log-extractorを、Claude Codeのターミナルで実行してほしい。実行後、対象のプロジェクトディレクトリ直下にexecution_log.jsonが作成/追記される。",
  },
  {
    q: "「実行ログ」「ルール整理」ページと、TopBarの「選択中プロジェクト」が違うプロジェクトを指しているように見える",
    a: "意図的な仕様。CLAUDE.md/スキル/設定/メモリなどは「設定管理の対象」であるTopBarの選択中プロジェクトに紐づくが、execution_log.jsonやrule_refactor_proposal.jsonはスキルを実際に実行した作業ディレクトリに書き出されるため、TopBarの選択とは無関係に生成される。そのため「実行ログ」「ルール整理」の2ページだけは、ページ上部に独自の「分析対象プロジェクト」セレクターを持ち、TopBarとは独立してどのプロジェクトのログ・提案を見るか選べるようにしている（登録済みプロジェクトの一覧から選ぶ点は共通）。「実行ログ」でルールを保存する際の保存先はTopBarの選択中プロジェクトのCLAUDE.mdになる点に注意（保存先はボタン付近に表示される）。",
  },
]

export default function HelpPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold">使い方ガイド</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Claude Codeを初めて触る方でも迷わないよう、このダッシュボードの考え方・用語・各ページの読み方をまとめています。
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-2 pt-4">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {s.label}
            </a>
          ))}
        </CardContent>
      </Card>

      <section id="about" className="scroll-mt-20 space-y-3">
        <h2 className="text-lg font-semibold">このダッシュボードとは</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <Link href="https://claude.com/claude-code" className="underline">
            Claude Code
          </Link>
          は、ターミナル上で動くAIコーディングエージェントです。Claude
          Codeは会話を重ねるうちに、「CLAUDE.md」というルールファイルや「スキル」、実行結果のログなど、様々な情報をローカルのファイルに書き出していきます。
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          本ダッシュボードは、それらのファイルを人間が読みやすい形で可視化し、GUIで編集できるようにするローカルのWebアプリです。
          重い処理（AIによる推論や実行）はすべてClaude
          Code本体に任せ、ダッシュボード自体はファイルを読み書きして表示するだけの軽量な作りになっています（外部API通信なし・コスト0円）。
        </p>
      </section>

      <section id="concept" className="scroll-mt-20 space-y-3">
        <h2 className="text-lg font-semibold">基本的な考え方</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          このプロジェクトが目指しているのは「1-Shot完了」——1回の指示だけで、思い通りの高品質な成果物を完成させることです。
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          最初の指示の時点では、ユーザー自身も要望を完全には言語化できていないことがよくあります。そのため、Claude
          Codeが実際に作業を進める中で「もっとこうしてほしい」という手戻り（介入）が発生します。
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          本ダッシュボードは、その手戻りを「次回のために覚えておくべきルール」「次はこう頼めば一発で終わる次回用プロンプト」として蓄積・整理する場所です。使い込むほど、CLAUDE.mdやスキルにユーザーの好みが蓄積され、次第に少ない指示で理想の成果物が出るようになっていきます。
        </p>
      </section>

      <section id="glossary" className="scroll-mt-20 space-y-3">
        <h2 className="text-lg font-semibold">用語集</h2>
        <Card>
          <CardContent className="divide-y pt-4">
            {GLOSSARY.map((g) => (
              <div key={g.term} className="grid grid-cols-1 gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[200px_1fr] sm:gap-4">
                <dt className="font-mono text-sm font-medium">{g.term}</dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">{g.description}</dd>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section id="pages" className="scroll-mt-20 space-y-3">
        <h2 className="text-lg font-semibold">各ページの使い方</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {PAGE_GUIDES.map((p) => (
            <Card key={p.href}>
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <p.icon className="size-4 text-primary" />
                <CardTitle className="text-sm">
                  <Link href={p.href} className="hover:underline">
                    {p.label}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="leading-relaxed">{p.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section id="faq" className="scroll-mt-20 space-y-3">
        <h2 className="text-lg font-semibold">困ったときは</h2>
        <div className="space-y-3">
          {FAQ.map((item) => (
            <Alert key={item.q}>
              <AlertTitle>{item.q}</AlertTitle>
              <AlertDescription>{item.a}</AlertDescription>
            </Alert>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          解決しない場合は <Badge variant="outline">README.md</Badge> も参照してください。
        </p>
      </section>
    </div>
  )
}
