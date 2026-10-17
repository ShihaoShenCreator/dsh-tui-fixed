/**
 * Display names for the terminal settings panel.
 *
 * The Host reports one settings entry per profile plugin, identified by its
 * Loader entry id (`pwsh-sandbox`, `agent-default-model`, …). Those ids are
 * configuration keys, not names: they are what a write addresses, and a reader
 * should not have to parse them. Upstream ships per-package locale dictionaries
 * (`locale/zh.json` → `meta.title`) through `0.2.1-rc.1`, but the `0.2.0-rc.2`
 * line this package targets dropped the `./locale/*.json` export, so the
 * terminal cannot read them at runtime. The titles below are copied from those
 * dictionaries, keeping the terminal's wording identical to the Web settings
 * pages; an id the table does not know is prettified instead of guessed at.
 *
 * Field names have no upstream source at all: a Schemastery node carries only
 * `meta.description`. The high-frequency keys are translated here and every
 * other key falls back to its identifier split into words.
 * @module @shihaoshen/dsh-tui-fixed/settings/labels
 */

import { detectLocale, systemLocale, type LocaleId } from '../i18n/locale.ts'

/** Language the panel's display names render in: one of the shipped locales. */
export type LabelLanguage = LocaleId

/** One label in both languages. */
interface Label {
  readonly en: string
  readonly zh: string
}

/**
 * Section titles, keyed by the profile entry id. Values mirror each package's
 * upstream `locale/*.json` `meta.title`.
 */
const SECTION_TITLES: Readonly<Record<string, Label>> = {
  'agent-default-model': { en: 'Default model', zh: '默认模型' },
  'agent-loop': { en: 'Agent loop', zh: '智能体运行循环' },
  'agent-preset-registry': { en: 'Agent presets', zh: 'Agent 预设管理' },
  'bash-sandbox': { en: 'Bash sandbox', zh: 'Bash 沙箱执行' },
  'client-locale': { en: 'Interface language', zh: '界面语言' },
  'compaction-basic': { en: 'Context compaction', zh: '上下文压缩' },
  'llm-deepseek': { en: 'DeepSeek API key', zh: 'DeepSeek API 密钥接入' },
  'llm-deepseek-account': { en: 'DeepSeek account', zh: 'DeepSeek 账号模型接入' },
  'llm-pi-ai': { en: 'pi-ai model adapter', zh: 'pi-ai 模型适配' },
  'permission': { en: 'Permission mode', zh: '权限模式服务' },
  'pwsh-sandbox': { en: 'PowerShell sandbox', zh: 'PowerShell 沙箱执行' },
  'session-log-deepseek': { en: 'DeepSeek session log upload', zh: 'DeepSeek 会话日志上传' },
  'subagent': { en: 'Subagent', zh: '子智能体服务' },
  'tools': { en: 'Tools', zh: '工具注册与执行' },
  'ui-chat': { en: 'Chat view', zh: '对话视图' },
  'ui-theme': { en: 'Interface theme', zh: '界面主题' },
  'web-search-deepseek': { en: 'DeepSeek web search', zh: 'DeepSeek 网页搜索' },
}

/**
 * Field names, keyed by the last path segment. Only keys whose identifier is
 * unreadable as words are listed; everything else falls back to
 * {@link prettify}.
 */
const FIELD_NAMES: Readonly<Record<string, Label>> = {
  apiKey: { en: 'API key', zh: 'API 密钥' },
  apiKeyEnv: { en: 'API key env var', zh: 'API 密钥环境变量' },
  baseURL: { en: 'Base URL', zh: '接口地址' },
  codeFontFamily: { en: 'Code font', zh: '代码字体' },
  codeFontSize: { en: 'Code font size', zh: '代码字号' },
  defaultPreset: { en: 'Default permission mode', zh: '默认权限模式' },
  enabled: { en: 'Enabled', zh: '启用' },
  fallbackMaxBytes: { en: 'Fallback title bytes', zh: '标题回退字节数' },
  fallbackMaxWords: { en: 'Fallback title words', zh: '标题回退词数' },
  fontSize: { en: 'Font size', zh: '字号' },
  graceMs: { en: 'Kill grace (ms)', zh: '终止宽限（毫秒）' },
  maxActiveSubagents: { en: 'Max concurrent subagents', zh: '最大并发子智能体' },
  maxDepth: { en: 'Max delegation depth', zh: '最大委派深度' },
  maxDiffEditLength: { en: 'Max diff edit length', zh: '差异计算上限' },
  maxImagesPerRequest: { en: 'Max images per request', zh: '单次请求图片上限' },
  maxInlineRequestImageBytes: { en: 'Max inline image bytes', zh: '内联图片字节上限' },
  maxOutputBytes: { en: 'Output cap (bytes)', zh: '输出上限（字节）' },
  maxOutputTokens: { en: 'Max output tokens', zh: '最大输出 token' },
  maxParallelToolCalls: { en: 'Max parallel tool calls', zh: '最大并行工具调用' },
  maxRequestFilesBytes: { en: 'Max request file bytes', zh: '请求文件字节上限' },
  maxSpillBytes: { en: 'Spill cap (bytes)', zh: '溢出上限（字节）' },
  maxTimeoutMs: { en: 'Max timeout (ms)', zh: '最大超时（毫秒）' },
  maxTokens: { en: 'Max tokens', zh: '最大 token' },
  maxUses: { en: 'Max uses', zh: '最大调用次数' },
  model: { en: 'Model', zh: '模型' },
  modelOverrides: { en: 'Model overrides', zh: '模型覆盖' },
  modelsTimeoutMs: { en: 'Catalog timeout (ms)', zh: '目录超时（毫秒）' },
  preference: { en: 'Preference', zh: '偏好' },
  provider: { en: 'Provider', zh: '提供方' },
  providers: { en: 'Providers', zh: '提供方' },
  pwshPath: { en: 'PowerShell path', zh: 'PowerShell 路径' },
  reasoningEffort: { en: 'Reasoning effort', zh: '推理强度' },
  retryPolicy: { en: 'Retry policy', zh: '重试策略' },
  selectedDefault: { en: 'Default preset', zh: '默认预设' },
  streamIdleTimeoutMs: { en: 'Stream idle timeout (ms)', zh: '流空闲超时（毫秒）' },
  targetCjkCharacters: { en: 'Title CJK length', zh: '标题中日韩字符数' },
  targetWords: { en: 'Title words', zh: '标题词数' },
  textFontFamily: { en: 'Text font', zh: '正文字体' },
  textFontSize: { en: 'Text font size', zh: '正文字号' },
  thinking: { en: 'Thinking mode', zh: '思考模式' },
  timeoutMs: { en: 'Timeout (ms)', zh: '超时（毫秒）' },
}

/** Keys of the panel's own session-local rows. */
const LOCAL_FIELD_NAMES: Readonly<Record<string, Label>> = {
  showReasoning: { en: 'Show reasoning', zh: '显示推理过程' },
  toolCards: { en: 'Tool card detail', zh: '工具卡片详细度' },
}

/** Values the session-local rows offer, translated for display. */
const LOCAL_ENUM_NAMES: Readonly<Record<string, Label>> = {
  collapsed: { en: 'collapsed', zh: '折叠' },
  expanded: { en: 'expanded', zh: '展开' },
  hidden: { en: 'hidden', zh: '隐藏' },
}

/**
 * Resolve a label language from the environment.
 *
 * The panel normally renders the terminal's own interface language, so the
 * controller passes the active `LocaleId` and this stays a convenience for
 * callers that only have an environment (the `prepare`-time probes and tests).
 * `DSH_TUI_LANG` is honoured first so a one-process override remains possible.
 * @param env - Environment to read; defaults to the process environment.
 * @param fallback - Operating-system language tag read when the environment is silent.
 * @returns `zh` for a Chinese locale, otherwise `en`.
 */
export function resolveLabelLanguage(
  env: Record<string, string | undefined> = process.env,
  fallback: string = systemLocale(),
): LabelLanguage {
  const explicit = env.DSH_TUI_LANG?.trim().toLowerCase()
  if (explicit !== undefined && explicit !== '') return explicit.startsWith('zh') ? 'zh' : 'en'
  return detectLocale(env, fallback)
}

/** Split an identifier into words: camelCase humps, underscores, and dashes. */
function words(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s._-]+/u)
    .filter(word => word !== '')
}

/**
 * Render an identifier as words, capitalized.
 * @param identifier - camelCase, snake_case, or kebab-case name.
 * @returns The humanized text, or the identifier itself when it has no letters.
 */
export function prettify(identifier: string): string {
  const parts = words(identifier)
  if (parts.length === 0) return identifier
  return parts
    .map((word, index) => {
      // Acronyms and short all-caps tokens (`API`, `URL`, `AI`) stay as written.
      if (word.length > 1 && word === word.toUpperCase()) return word
      return index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word.toLowerCase()
    })
    .join(' ')
}

/**
 * Display title for one settings section.
 * @param ns - Profile entry id the section edits.
 * @param language - Language to render.
 * @returns The known upstream title, or the prettified id.
 */
export function sectionTitle(ns: string, language: LabelLanguage): string {
  return SECTION_TITLES[ns]?.[language] ?? prettify(ns)
}

/**
 * Display name for one settings field.
 * @param path - Path from the section root; array indexes are not names.
 * @param language - Language to render.
 * @param local - Whether this row belongs to the panel's own session group.
 * @returns The translated name, or the prettified identifier.
 */
export function fieldName(path: readonly string[], language: LabelLanguage, local = false): string {
  // Drop array indexes: `rows.0.name` is the `name` of a row, not a field
  // called `0`.
  const named = path.filter(segment => !/^(0|[1-9][0-9]*)$/u.test(segment))
  const key = named.at(-1)
  if (key === undefined) return path.length === 0 ? '' : prettify(path.at(-1) ?? '')
  const table = local ? LOCAL_FIELD_NAMES : FIELD_NAMES
  return table[key]?.[language] ?? FIELD_NAMES[key]?.[language] ?? prettify(key)
}

/**
 * Display text for one value the panel offers as a fixed set.
 * @param value - Enum member or boolean rendered as `on`/`off`.
 * @param language - Language to render.
 * @returns The translated label, or the value unchanged.
 */
export function enumLabel(value: string, language: LabelLanguage): string {
  return LOCAL_ENUM_NAMES[value]?.[language] ?? value
}
