/**
 * Public interface-language surface for `@shihaoshen/dsh-tui-fixed`: the shipped
 * locale ids and labels, environment detection, and the translator an embedder
 * binds to render the terminal's copy in one language.
 * @module @shihaoshen/dsh-tui-fixed/i18n
 */

export {
  detectLocale,
  isLocaleId,
  localeSettingOf,
  LOCALE_IDS,
  LOCALE_LABELS,
  resolveLocale,
  systemLocale,
  type LocaleId,
  type LocaleSetting,
} from './locale.ts'
export {
  createTranslator,
  retargetTranslator,
  translate,
  type Dictionary,
  type TranslationEntry,
  type TranslationKey,
  type Translator,
  type TParams,
} from './translate.ts'
