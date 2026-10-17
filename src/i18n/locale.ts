/**
 * Language identity and environment resolution for the terminal front door.
 * The terminal ships the same two locales as the harness client — English and
 * Chinese — resolves `auto` from the process environment the way the Unix tools
 * do (`LC_ALL`, then `LC_MESSAGES`, then `LANG`), and falls back to the
 * operating system's own language when the process names none.
 * @module @shihaoshen/dsh-tui-fixed/i18n/locale
 */

/** Locales this terminal ships dictionaries for, in listing order. */
export const LOCALE_IDS = ['en', 'zh'] as const

/** One shipped locale id. */
export type LocaleId = typeof LOCALE_IDS[number]

/**
 * Configured language preference: a shipped locale, or `auto` to follow the
 * environment. This is the value the config schema accepts; {@link resolveLocale}
 * turns it into the locale that actually renders.
 */
export type LocaleSetting = 'auto' | LocaleId

/** Display name of each shipped locale, shown by the Language setting row. */
export const LOCALE_LABELS: Readonly<Record<LocaleId, string>> = Object.freeze({
  en: 'English',
  zh: '中文',
})

/** Whether a string is a shipped locale id. */
export function isLocaleId(value: string): value is LocaleId {
  return (LOCALE_IDS as readonly string[]).includes(value)
}

/**
 * The operating system's preferred language, read from the same source the
 * browser client and the desktop shell read (`navigator.languages` there,
 * `Intl` here). Node reports the ICU default locale, which follows the OS
 * language on every platform.
 *
 * @returns The system language tag, or `''` when it cannot be read.
 */
export function systemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    /* v8 ignore next -- an ICU-less Node build is the only way to reach this. */
    return ''
  }
}

/** The primary subtag of a BCP 47 or POSIX language tag, lowercased. */
function primarySubtag(tag: string): string {
  const bare = tag.split('.')[0]?.split('@')[0] ?? ''
  return (bare.replace(/_/gu, '-').split('-')[0] ?? '').toLowerCase()
}

/**
 * Read the environment's preferred language. The first set of LC_ALL,
 * LC_MESSAGES, and LANG wins; the tag's encoding and modifier suffixes are
 * dropped (`zh_CN.UTF-8@mod` becomes `zh-CN`), and only a Chinese primary
 * subtag selects Chinese. Every other value falls back to English, including
 * `C`/`POSIX`. An environment that names none of the three variables delegates
 * to the operating system's language, so a Windows terminal — which exports no
 * locale variables at all — still starts in the user's language.
 *
 * @param env - Environment to read; defaults to the process environment.
 * @param fallback - Operating-system language tag read when the environment is silent.
 * @returns The detected locale.
 */
export function detectLocale(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fallback: string = systemLocale(),
): LocaleId {
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || fallback
  return primarySubtag(raw) === 'zh' ? 'zh' : 'en'
}

/**
 * Resolve a configured preference into the locale that renders. `auto` (and an
 * absent value) delegates to {@link detectLocale}; an explicit locale is used
 * as given.
 *
 * @param setting - Configured preference.
 * @param env - Environment to read for detection; defaults to the process environment.
 * @param fallback - Operating-system language tag read when the environment is silent.
 * @returns The locale to render with.
 */
export function resolveLocale(
  setting: LocaleSetting | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fallback: string = systemLocale(),
): LocaleId {
  if (setting === undefined || setting === 'auto') return detectLocale(env, fallback)
  return setting
}

/**
 * Read one configured locale value, which the Loader hands over as either the
 * plain setting or a volatile reference. Direct callers (tests, embeddings)
 * pass the plain value; a running plugin config passes the reference.
 *
 * @param value - Configured locale setting, volatile reference, or absent.
 * @returns The setting the value names, or `undefined` when it names none.
 */
export function localeSettingOf(value: unknown): LocaleSetting | undefined {
  const raw: unknown = typeof value === 'object' && value !== null && 'get' in value
    ? (value as { get(): unknown }).get()
    : value
  if (typeof raw !== 'string') return undefined
  return raw === 'auto' || isLocaleId(raw) ? raw : undefined
}
