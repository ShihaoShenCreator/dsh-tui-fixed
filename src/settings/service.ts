/**
 * Optional access to the Host's live-configuration service from the terminal.
 *
 * The TUI is a bundle layer over the shared base, whose `settings` row is only
 * active while the launcher supplies a `profileContext`. Embeddings and tests
 * mount the TUI without one, so this module reads the service structurally
 * through `ctx.get` instead of importing `@deepseek-ai/dsh-settings`: adding a
 * runtime dependency would make an optional Host row a hard requirement of
 * every composition that mounts the terminal front door.
 * @module @shihaoshen/dsh-tui-fixed/settings/service
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsDescriptorView } from './schema-form.ts'
import type { Translator } from '../i18n/translate.ts'

/** One path-addressed edit, as the Host's settings service accepts it. */
export type SettingsPathOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** The subset of the Host settings service this terminal uses. */
export interface SettingsFormsLike {
  /** Whether the active profile accepts form edits. */
  readonly writable: boolean
  /** Profile patch document the form edits persist through. */
  readonly documentPath: string
  /**
   * Read active entries and their live values.
   * @param options - `redactSecrets` strips `role('secret')` values for display surfaces.
   * @returns One descriptor per configurable entry.
   */
  describe(options?: { readonly redactSecrets?: boolean }): readonly SettingsDescriptorView[]
  /**
   * Apply ordered field edits to one entry.
   * @param ns - Profile entry id.
   * @param ops - Ordered field operations.
   * @param expectedRevision - Revision the caller read; a stale one is refused.
   */
  mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
}

/**
 * Human-readable failure text for one settings write.
 * @param error - Value thrown by the Host, typically a `SettingsConflictError`.
 * @param t - Translator supplying the conflict copy.
 * @returns A notice line for the panel.
 */
export function settingsWriteError(error: unknown, t: Translator['t']): string {
  const code: unknown = typeof error === 'object' && error !== null
    ? Reflect.get(error, 'code')
    : undefined
  if (code === 'SETTINGS_CONFLICT') return t('settings.conflict')
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read the live-configuration service when this composition has one.
 * @param ctx - Any context whose service store should be consulted.
 * @returns The service, or `undefined` when the profile exposes no document.
 */
export function settingsService(ctx: Context): SettingsFormsLike | undefined {
  // `strict: false` deliberately accepts an implementation whose providing fiber
  // is momentarily between states; the caller re-reads it on every command.
  const candidate = ctx.get('settings', false) as SettingsFormsLike | undefined
  return candidate === undefined || typeof candidate.describe !== 'function' ? undefined : candidate
}

/**
 * Subscribe to the Host's configuration-change notification. The event name
 * comes from `@deepseek-ai/dsh-settings`, which this package does not depend on,
 * so it is spelled here as a string.
 * @param ctx - Context to subscribe on.
 * @param listener - Called after one entry's form values changed.
 * @returns The disposer removing the subscription.
 */
export function onSettingsChange(ctx: Context, listener: () => void): () => void {
  const events = ctx as unknown as {
    on(name: string, callback: () => void): () => void
  }
  return events.on('settings/document-updated', listener)
}
