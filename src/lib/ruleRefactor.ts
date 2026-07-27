import { promises as fs } from "fs"
import { parseClaudeMd, serializeClaudeMd } from "./claudeMdParser"
import { readJsonFile, readTextFile, resolveProjectPath, writeTextFile } from "./fileIO"
import {
  ProjectConfig,
  Rule,
  RuleProposal,
  RuleRefactorApplyResult,
  RuleRefactorDiffItem,
  RuleRefactorDiffResult,
  RuleRefactorProposalFile,
} from "./types"

const PROPOSAL_VERSION = 1
const PROPOSAL_FILE_NAME = "rule_refactor_proposal.json"

function proposalPath(project: ProjectConfig): string {
  return resolveProjectPath(project.path, PROPOSAL_FILE_NAME)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * rule-optimizerスキルが生成する提案ファイルを読み込む。ユーザーが直接アップロードする
 * exportImport.tsのバンドルとは異なり、Claude Code側が生成する非対話的な出力ファイルのため、
 * execution_log.json（executionLog.ts）と同様に寛容な方針を取る：ファイル自体が無い/トップレベルの
 * 形式が壊れている場合はnull（提案なし）を返し、個々のproposal要素が壊れている場合はその要素だけを
 * 黙ってスキップする（ダッシュボード全体がエラーにならないようにする）。
 */
async function readProposalFile(project: ProjectConfig): Promise<RuleRefactorProposalFile | null> {
  const raw = await readJsonFile<unknown>(proposalPath(project), null)
  if (!isRecord(raw) || !Array.isArray(raw.proposals)) return null

  const proposals: RuleProposal[] = []
  for (const p of raw.proposals) {
    if (!isRecord(p)) continue
    const type = p.type
    if (type !== "modify" && type !== "merge" && type !== "remove") continue
    if (typeof p.targetCategory !== "string") continue
    if (!Array.isArray(p.sourceCategories) || p.sourceCategories.length === 0) continue
    if (p.sourceCategories.some((c: unknown) => typeof c !== "string")) continue
    if (typeof p.reason !== "string") continue

    if (type === "remove") {
      proposals.push({
        type,
        targetCategory: p.targetCategory,
        sourceCategories: p.sourceCategories as string[],
        content: null,
        reason: p.reason,
      })
      continue
    }
    if (typeof p.content !== "string") continue
    proposals.push({
      type,
      targetCategory: p.targetCategory,
      sourceCategories: p.sourceCategories as string[],
      content: p.content,
      reason: p.reason,
    })
  }

  return {
    version: PROPOSAL_VERSION,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : new Date(0).toISOString(),
    proposals,
  }
}

/** 提案の現在のCLAUDE.mdに対する適用可否を判定する。参照するsourceCategoriesが1つでも
 * 現存しない場合は"stale"（提案生成後にルールが編集・削除された可能性がある）とする */
export async function computeRefactorDiff(project: ProjectConfig): Promise<RuleRefactorDiffResult> {
  const proposalFile = await readProposalFile(project)
  if (!proposalFile) return { generatedAt: null, items: [] }

  const claudeMdPath = resolveProjectPath(project.path, "CLAUDE.md")
  const content = await readTextFile(claudeMdPath, "")
  const { rules: currentRules } = parseClaudeMd(content)
  const byCategory = new Map(currentRules.map((r) => [r.category, r]))

  const items: RuleRefactorDiffItem[] = proposalFile.proposals.map((p, index) => {
    const missing = p.sourceCategories.filter((c) => !byCategory.has(c))
    if (missing.length > 0) {
      return {
        index,
        type: p.type,
        targetCategory: p.targetCategory,
        sourceCategories: p.sourceCategories,
        reason: p.reason,
        status: "stale",
        before: null,
        after: p.content,
        staleReason: `見出し「${missing.join("」「")}」が現在のCLAUDE.mdに見つかりません（提案生成後に編集・削除された可能性があります）`,
      }
    }
    const before = p.sourceCategories.map((c) => `## ${c}\n${byCategory.get(c)!.content}`).join("\n\n")
    return {
      index,
      type: p.type,
      targetCategory: p.targetCategory,
      sourceCategories: p.sourceCategories,
      reason: p.reason,
      status: "ready",
      before,
      after: p.content,
    }
  })

  return { generatedAt: proposalFile.generatedAt, items }
}

/** 上書き前に同名バックアップ(`<file>.ccd-backup.<epoch ms>`)を作成する。元ファイルが無い場合は何もしない */
async function backupFile(filePath: string): Promise<string | null> {
  try {
    await fs.access(filePath)
  } catch {
    return null
  }
  const backupPath = `${filePath}.ccd-backup.${Date.now()}`
  await fs.copyFile(filePath, backupPath)
  return backupPath
}

export async function applyRefactorProposal(
  project: ProjectConfig,
  selectedIndexes: number[]
): Promise<RuleRefactorApplyResult> {
  const proposalFile = await readProposalFile(project)
  if (!proposalFile) throw new Error("提案ファイル（rule_refactor_proposal.json）が見つかりません")

  const selected = [...new Set(selectedIndexes)]
    .map((i) => proposalFile.proposals[i])
    .filter((p): p is RuleProposal => p !== undefined)
  if (selected.length === 0) {
    return { backups: [] }
  }

  const claudeMdPath = resolveProjectPath(project.path, "CLAUDE.md")
  const content = await readTextFile(claudeMdPath, "")
  const { preamble, rules: currentRules } = parseClaudeMd(content)

  // 適用直前の再検証（TOCTOU対策）：diffプレビュー表示後に他プロセスがCLAUDE.mdを
  // 編集した可能性があるため、選択された提案のsourceCategoriesが全て現存するか確認する
  for (const p of selected) {
    const missing = p.sourceCategories.filter((c) => !currentRules.some((r) => r.category === c))
    if (missing.length > 0) {
      throw new Error(
        `見出し「${missing.join("」「")}」が現在のCLAUDE.mdと一致しないため適用できません。画面を再読み込みしてください`
      )
    }
  }

  const backup = await backupFile(claudeMdPath)
  const backups = backup ? [backup] : []

  let rules = currentRules
  for (const p of selected) {
    const sourceSet = new Set(p.sourceCategories)
    if (p.type === "remove") {
      rules = rules.filter((r) => !sourceSet.has(r.category))
      continue
    }
    const isSimpleModify = p.sourceCategories.length === 1 && p.sourceCategories[0] === p.targetCategory
    if (isSimpleModify) {
      const idx = rules.findIndex((r) => r.category === p.targetCategory)
      const updated: Rule = { ...rules[idx], content: p.content ?? "" }
      rules = [...rules.slice(0, idx), updated, ...rules.slice(idx + 1)]
    } else {
      const rest = rules.filter((r) => !sourceSet.has(r.category))
      const merged: Rule = {
        id: `sec-${rest.length}`,
        category: p.targetCategory,
        content: p.content ?? "",
        enabled: true,
      }
      rules = [...rest, merged]
    }
  }

  await writeTextFile(claudeMdPath, serializeClaudeMd(preamble, rules))
  return { backups }
}
