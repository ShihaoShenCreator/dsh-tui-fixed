/**
 * Serializable configuration and defaults for the pi-tui terminal mode. Loader
 * schema validation normally fills defaults; {@link resolveTuiConfig} applies
 * the same defaults for direct callers that bypass the Loader.
 * @module @shihaoshen/dsh-tui-fixed/config
 */

import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
} from './chat/file-autocomplete.ts'
import {
  localeSettingOf,
  LOCALE_IDS,
  resolveLocale,
  systemLocale,
  type LocaleId,
  type LocaleSetting,
} from './i18n/locale.ts'
import { translate } from './i18n/translate.ts'

/** Theme and prompt-template settings for the pi-tui terminal mode. */
export interface TuiThemeConfig {
  /** Apply the built-in ANSI color palette. */
  color?: boolean
  /** Paint the startup banner with the 24-bit DeepSeek brand gradient. */
  truecolor?: boolean
  /** Left-aligned template on the row above the editor. */
  leftPrompt?: string
  /** Right-aligned template on the row above the editor. */
  rightPrompt?: string
  /** Template used as the editor's first-line prefix. */
  inputPrompt?: string
  /** Static placeholder shown in an empty editor while the agent is running. */
  inputPlaceholder?: string
}

/** Interaction and presentation settings for the pi-tui terminal mode. */
export interface TuiConfig {
  /** Render model reasoning blocks. */
  showReasoning?: boolean
  /** Maximum tool-card body lines retained in its collapsed head/tail preview. */
  maxToolOutputLines?: number
  /** Maximum added and removed lines explored while deriving an exact line diff. */
  maxDiffEditLength?: number
  /** Maximum options visible at once in a user-question panel. */
  maxQuestionOptions?: number
  /** Maximum models visible at once in the model selector. */
  maxModelOptions?: number
  /** Maximum sessions visible at once in the resume selector. */
  maxResumeOptions?: number
  /** Maximum concurrent cold projection reads in one resume scan. */
  resumeScanConcurrency?: number
  /** Maximum field rows visible at once in the settings panel. */
  maxSettingsFields?: number
  /** Settings panel width in terminal columns. */
  settingsDialogWidth?: number
  /** Settings panel maximum height in terminal rows. */
  settingsDialogMaxHeight?: number
  /** User-question panel width in terminal columns, clamped to the terminal. */
  questionDialogWidth?: number
  /** User-question panel maximum height in terminal rows. */
  questionDialogMaxHeight?: number
  /** Model-selector width in terminal columns. */
  modelDialogWidth?: number
  /** Model-selector maximum height in terminal rows. */
  modelDialogMaxHeight?: number
  /** Transcript-details selector width in terminal columns. */
  detailsDialogWidth?: number
  /** Maximum fuzzy file candidates displayed for one `@` query. */
  fileSearchMaxResults?: number
  /** Maximum paths retained in one `@` workspace index. */
  fileSearchMaxEntries?: number
  /** Directory basenames excluded from `@` traversal and completion. */
  fileSearchExcludedDirectories?: string[]
  /** Show the terminal's hardware cursor at the pi editor's IME marker. */
  showHardwareCursor?: boolean
  /**
   * Interface language. `auto` (the default) follows the process environment's
   * `LC_ALL`/`LC_MESSAGES`/`LANG`, then the operating system's own language; an
   * explicit id pins one shipped locale. The Live setting field means the
   * Loader hands a running plugin the volatile reference instead of the plain
   * value, so both shapes are accepted here.
   */
  locale?: LocaleSetting | Volatile<LocaleSetting | undefined>
  /** Color and prompt-template settings. */
  theme?: TuiThemeConfig
  /** Terminal window title while the UI is mounted; a logged session title prefixes it. */
  title?: string
}

const showReasoningSchema = z.boolean().default(true)
const maxToolOutputLinesSchema = z.number().step(1).min(1).default(6)
const maxDiffEditLengthSchema = z.number().step(1).min(1).default(1000)
const maxQuestionOptionsSchema = z.number().step(1).min(1).default(8)
const maxModelOptionsSchema = z.number().step(1).min(1).default(8)
const maxResumeOptionsSchema = z.number().step(1).min(1).default(8)
const resumeScanConcurrencySchema = z.number().step(1).min(1).default(4)
const maxSettingsFieldsSchema = z.number().step(1).min(3).default(10)
const settingsDialogWidthSchema = z.number().step(1).min(20).default(88)
const settingsDialogMaxHeightSchema = z.number().step(1).min(8).default(22)
const questionDialogWidthSchema = z.number().step(1).min(20).default(200)
const questionDialogMaxHeightSchema = z.number().step(1).min(6).default(20)
const modelDialogWidthSchema = z.number().step(1).min(20).default(76)
const modelDialogMaxHeightSchema = z.number().step(1).min(6).default(20)
const detailsDialogWidthSchema = z.number().step(1).min(20).default(72)
const fileSearchMaxResultsSchema = z.number().step(1).min(1).default(DEFAULT_FILE_SEARCH_MAX_RESULTS)
const fileSearchMaxEntriesSchema = z.number().step(1).min(1).default(DEFAULT_FILE_SEARCH_MAX_ENTRIES)
const fileSearchExcludedDirectoriesSchema = z.array(z.string()).default([...DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES])
const showHardwareCursorSchema = z.boolean().default(false)
// `auto` is the default so a deployment that never names a language still
// follows the user's environment, the way coreutils and git do. Volatile so the
// Language row in `/settings` switches a running terminal without a remount.
const localeSchema = z.union([
  z.const('auto'),
  ...LOCALE_IDS.map(id => z.const(id)),
]).default('auto').volatile()
const colorSchema = z.boolean().default(true)
// No default: an unset value auto-detects truecolor from COLORTERM in `apply`.
const truecolorSchema = z.boolean()
const DEFAULT_LEFT_PROMPT = '${cwd}${git/worktree}${model}${token_meter/cache_hit_rate}${context}'
const DEFAULT_RIGHT_PROMPT = '${queued}'
const DEFAULT_INPUT_PROMPT = '${symbol} ${indicator}'
// No schema default: the placeholder's default text follows the interface
// language, so it is filled in by `resolveTuiConfig` after the locale resolves.
const inputPlaceholderSchema = z.string()
const TuiThemeConfigSchema: z<TuiThemeConfig> = z.object({
  color: colorSchema,
  truecolor: truecolorSchema,
  leftPrompt: z.string().default(DEFAULT_LEFT_PROMPT),
  rightPrompt: z.string().default(DEFAULT_RIGHT_PROMPT),
  inputPrompt: z.string().default(DEFAULT_INPUT_PROMPT),
  inputPlaceholder: inputPlaceholderSchema,
})
const titleSchema = z.string().default('DeepSeek Harness')

const tuiConfigSchemaFields = {
  showReasoning: showReasoningSchema,
  maxToolOutputLines: maxToolOutputLinesSchema,
  maxDiffEditLength: maxDiffEditLengthSchema,
  maxQuestionOptions: maxQuestionOptionsSchema,
  maxModelOptions: maxModelOptionsSchema,
  maxResumeOptions: maxResumeOptionsSchema,
  resumeScanConcurrency: resumeScanConcurrencySchema,
  maxSettingsFields: maxSettingsFieldsSchema,
  settingsDialogWidth: settingsDialogWidthSchema,
  settingsDialogMaxHeight: settingsDialogMaxHeightSchema,
  questionDialogWidth: questionDialogWidthSchema,
  questionDialogMaxHeight: questionDialogMaxHeightSchema,
  modelDialogWidth: modelDialogWidthSchema,
  modelDialogMaxHeight: modelDialogMaxHeightSchema,
  detailsDialogWidth: detailsDialogWidthSchema,
  fileSearchMaxResults: fileSearchMaxResultsSchema,
  fileSearchMaxEntries: fileSearchMaxEntriesSchema,
  fileSearchExcludedDirectories: fileSearchExcludedDirectoriesSchema,
  showHardwareCursor: showHardwareCursorSchema,
  locale: localeSchema,
  theme: TuiThemeConfigSchema,
  title: titleSchema,
}

/** Schemastery schema for presentation settings embedded by app bundles. */
export type TuiConfigRaw = Omit<TuiConfig, 'locale'> & { locale?: LocaleSetting | null }
export const TuiConfigSchema: z<TuiConfigRaw, TuiConfig> = z.object(tuiConfigSchemaFields)

/** Serializable plugin configuration. */
export interface Config extends TuiConfig {
  /** Banner subtitle line. When absent, the banner has no subtitle and sweeps in on start. */
  welcome?: string
  /** Exact shared agent/session identity driven by this terminal. Defaults to `main`. */
  sessionId?: string
  /**
   * Skill name auto-invoked as this session's first user turn, exactly as if
   * the user typed `/skill:<name>`. Set only by a launcher for a fresh
   * skill-guided session (`dsh migrate`/`dsh upgrade`); absent
   * leaves the first turn to the user.
   */
  initialSkill?: string
}

/** Schemastery schema for the full plugin configuration. */
export type ConfigRaw = Omit<Config, 'locale'> & { locale?: LocaleSetting | null }
export const Config: z<ConfigRaw, Config> = z.object({
  welcome: z.string(),
  sessionId: z.string().default('main'),
  initialSkill: z.string(),
  showReasoning: tuiConfigSchemaFields.showReasoning,
  maxToolOutputLines: tuiConfigSchemaFields.maxToolOutputLines,
  maxDiffEditLength: tuiConfigSchemaFields.maxDiffEditLength,
  maxQuestionOptions: tuiConfigSchemaFields.maxQuestionOptions,
  maxModelOptions: tuiConfigSchemaFields.maxModelOptions,
  maxResumeOptions: tuiConfigSchemaFields.maxResumeOptions,
  resumeScanConcurrency: tuiConfigSchemaFields.resumeScanConcurrency,
  maxSettingsFields: tuiConfigSchemaFields.maxSettingsFields,
  settingsDialogWidth: tuiConfigSchemaFields.settingsDialogWidth,
  settingsDialogMaxHeight: tuiConfigSchemaFields.settingsDialogMaxHeight,
  questionDialogWidth: tuiConfigSchemaFields.questionDialogWidth,
  questionDialogMaxHeight: tuiConfigSchemaFields.questionDialogMaxHeight,
  modelDialogWidth: tuiConfigSchemaFields.modelDialogWidth,
  modelDialogMaxHeight: tuiConfigSchemaFields.modelDialogMaxHeight,
  detailsDialogWidth: tuiConfigSchemaFields.detailsDialogWidth,
  fileSearchMaxResults: tuiConfigSchemaFields.fileSearchMaxResults,
  fileSearchMaxEntries: tuiConfigSchemaFields.fileSearchMaxEntries,
  fileSearchExcludedDirectories: tuiConfigSchemaFields.fileSearchExcludedDirectories,
  showHardwareCursor: tuiConfigSchemaFields.showHardwareCursor,
  locale: tuiConfigSchemaFields.locale,
  theme: tuiConfigSchemaFields.theme,
  title: tuiConfigSchemaFields.title,
})

/** Fully defaulted TUI theme settings. */
export interface ResolvedTuiThemeConfig {
  color: boolean
  truecolor: boolean
  leftPrompt: string
  rightPrompt: string
  inputPrompt: string
  inputPlaceholder: string
}

/** Fully defaulted TUI presentation settings. */
export interface ResolvedTuiConfig {
  showReasoning: boolean
  maxToolOutputLines: number
  maxDiffEditLength: number
  maxQuestionOptions: number
  maxModelOptions: number
  maxResumeOptions: number
  resumeScanConcurrency: number
  maxSettingsFields: number
  settingsDialogWidth: number
  settingsDialogMaxHeight: number
  questionDialogWidth: number
  questionDialogMaxHeight: number
  modelDialogWidth: number
  modelDialogMaxHeight: number
  detailsDialogWidth: number
  fileSearchMaxResults: number
  fileSearchMaxEntries: number
  fileSearchExcludedDirectories: string[]
  showHardwareCursor: boolean
  /** Interface language every renderer translates through. */
  locale: LocaleId
  theme: ResolvedTuiThemeConfig
  title: string
}

/**
 * Apply direct-call defaults after Loader schema validation has normally run.
 *
 * @param config - Deployment-provided terminal presentation settings.
 * @param env - Environment read when `locale` is `auto`; injectable so a caller
 *   (or a test) can pin the interface language without touching the process.
 * @param fallbackLocale - Operating-system language tag read when `env` names no
 *   locale variable; injectable for the same reason.
 * @returns Complete settings consumed by the TUI renderer.
 */
export function resolveTuiConfig(
  config: TuiConfig | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fallbackLocale: string = systemLocale(),
): ResolvedTuiConfig {
  const locale = resolveLocale(localeSettingOf(config?.locale), env, fallbackLocale)
  return {
    showReasoning: config?.showReasoning ?? true,
    maxToolOutputLines: config?.maxToolOutputLines ?? 6,
    maxDiffEditLength: config?.maxDiffEditLength ?? 1000,
    maxQuestionOptions: config?.maxQuestionOptions ?? 8,
    maxModelOptions: config?.maxModelOptions ?? 8,
    maxResumeOptions: config?.maxResumeOptions ?? 8,
    resumeScanConcurrency: config?.resumeScanConcurrency ?? 4,
    maxSettingsFields: config?.maxSettingsFields ?? 10,
    settingsDialogWidth: config?.settingsDialogWidth ?? 88,
    settingsDialogMaxHeight: config?.settingsDialogMaxHeight ?? 22,
    questionDialogWidth: config?.questionDialogWidth ?? 200,
    questionDialogMaxHeight: config?.questionDialogMaxHeight ?? 20,
    modelDialogWidth: config?.modelDialogWidth ?? 76,
    modelDialogMaxHeight: config?.modelDialogMaxHeight ?? 20,
    detailsDialogWidth: config?.detailsDialogWidth ?? 72,
    fileSearchMaxResults: config?.fileSearchMaxResults ?? DEFAULT_FILE_SEARCH_MAX_RESULTS,
    fileSearchMaxEntries: config?.fileSearchMaxEntries ?? DEFAULT_FILE_SEARCH_MAX_ENTRIES,
    fileSearchExcludedDirectories: [...(config?.fileSearchExcludedDirectories ?? DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES)],
    showHardwareCursor: config?.showHardwareCursor ?? false,
    locale,
    theme: {
      color: config?.theme?.color ?? true,
      truecolor: config?.theme?.truecolor ?? false,
      leftPrompt: config?.theme?.leftPrompt ?? DEFAULT_LEFT_PROMPT,
      rightPrompt: config?.theme?.rightPrompt ?? DEFAULT_RIGHT_PROMPT,
      inputPrompt: config?.theme?.inputPrompt ?? DEFAULT_INPUT_PROMPT,
      inputPlaceholder: config?.theme?.inputPlaceholder ?? translate(locale, 'prompt.inputPlaceholder'),
    },
    title: config?.title ?? 'DeepSeek Harness',
  }
}
