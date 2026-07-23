export type RuleCategory = string

export interface Rule {
  id: string
  category: RuleCategory
  content: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface RulesFile {
  rules: Rule[]
}

export interface TradeOff {
  option_a: string
  option_b: string
}

export interface AgentsDiscussion {
  consensus_rate: number
  conflict_point: string
  trade_offs: TradeOff[]
}

export interface UserIntervention {
  step: number
  user_input: string
  cause_analysis: string
}

export interface SuggestedNewRule {
  category: string
  content: string
}

export interface ExecutionLogEntry {
  task_id: string
  task_name: string
  executed_at: string
  one_shot_score: number
  summary: string
  agents_discussion: AgentsDiscussion
  user_interventions: UserIntervention[]
  next_golden_prompt: string
  suggested_new_rules: SuggestedNewRule[]
}

export interface ExecutionLogFile {
  logs: ExecutionLogEntry[]
}

export interface ProjectConfig {
  id: string
  name: string
  path: string
}

export interface ProjectsFile {
  projects: ProjectConfig[]
  selectedProjectId: string | null
}

export interface ApiError {
  error: string
}
