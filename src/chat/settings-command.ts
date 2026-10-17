/**
 * `/settings` controller for the interactive chat channel: reads the Host's
 * live configuration, presents it in the terminal panel, and writes edits back
 * through the same service the Web settings pages use.
 *
 * The command is deliberately thin about policy. Which entries exist, which
 * fields are live-editable, and what values are legal are all the Host's
 * answers (`describe`/`mutate`); this module only projects them for the
 * terminal and keeps the session-local group in sync.
 * @module @shihaoshen/dsh-tui-fixed/chat/settings-command
 */

import type { SettingsDescriptorView, SettingsFieldSpec, SettingsSection } from '../settings/schema-form.ts'
import { fieldLabel, sectionsFromDescriptors } from '../settings/schema-form.ts'
import { enumLabel, fieldName } from '../settings/labels.ts'
import { onSettingsChange, settingsService, settingsWriteError } from '../settings/service.ts'
import type { SettingsPathOp } from '../settings/service.ts'
import type { ToolCardVisibility } from '../components/transcript.ts'
import { SettingsDialog } from '../components/settings-dialog.ts'
import type { TuiOverlaySession } from '../extension/types.ts'
import { displayInlineText } from '../components/text.ts'
import type { ChannelNotice, ChatChannelDeps } from './channel.ts'

/** Session-local settings the terminal owns rather than the profile document. */
export interface LocalSettingsState {
  /** Whether reasoning blocks render. */
  showReasoning: boolean
  /** Tool-card visibility phase. */
  toolCards: ToolCardVisibility
}

/** Collaborators the settings controller needs from the chat channel. */
export interface SettingsControllerDeps extends ChatChannelDeps, ChannelNotice {
  /** Current session-local state, read at each open/refresh. */
  localState(): LocalSettingsState
  /** Apply a session-local change; the channel rebuilds its views. */
  applyLocal(patch: Partial<LocalSettingsState>): void
}

/** Settings controller for one chat channel. */
export interface SettingsController {
  /**
   * Open the panel, optionally positioned on one Host namespace.
   * @param raw - Text after `/settings`, e.g. a namespace id.
   */
  open(raw: string): void
  /** Close any panel and drop the configuration-change subscription. */
  detach(): void
}

/** Command name token for the session-local group; never a Host namespace. */
const LOCAL_SECTION_ID = 'tui-session'

const TOOL_CARD_PHASES: readonly string[] = ['collapsed', 'expanded', 'hidden']

/**
 * Build the settings controller for one chat channel.
 * @param deps - channel collaborators plus the session-local state hooks.
 * @returns the controller wired to the `/settings` command.
 */
export function createSettingsController(deps: SettingsControllerDeps): SettingsController {
  const { ctx, resolved, palette, overlayManager, translator } = deps
  const labelLanguage = translator.locale
  let overlay: TuiOverlaySession | undefined
  let dialog: SettingsDialog | undefined
  let refreshing = false
  let pendingRefresh = false
  let refreshScheduled = false
  let detached = false

  /** Session-local rows, rebuilt from the channel's live state on each read. */
  const localSection = (): SettingsSection => {
    const state = deps.localState()
    const language = labelLanguage
    return {
      id: LOCAL_SECTION_ID,
      title: translator.t('settings.localSection'),
      kind: 'local',
      revision: 0,
      value: { showReasoning: state.showReasoning, toolCards: state.toolCards },
      user: {},
      writable: true,
      fields: [
        {
          path: ['showReasoning'],
          label: fieldName(['showReasoning'], language, true),
          kind: 'boolean',
          description: translator.t('settings.field.showReasoning'),
        },
        {
          path: ['toolCards'],
          label: fieldName(['toolCards'], language, true),
          kind: 'enum',
          enumValues: TOOL_CARD_PHASES,
          enumLabels: TOOL_CARD_PHASES.map(value => enumLabel(value, language)),
          description: translator.t('settings.field.toolCards'),
        },
      ],
    }
  }

  /** Read every configurable entry, or report why the panel cannot open. */
  const readSections = (sideEffects: boolean): SettingsSection[] | undefined => {
    const settings = settingsService(ctx)
    if (settings === undefined) {
      if (sideEffects) {
        deps.appendNotice(translator.t('settings.unavailable'), 'warning')
      }
      return undefined
    }
    let descriptors: readonly SettingsDescriptorView[]
    try {
      descriptors = settings.describe({ redactSecrets: true })
    } catch (error) {
      if (sideEffects) {
        deps.appendNotice(translator.t('settings.readFailed', { error: settingsWriteError(error, translator.t) }), 'error')
      }
      return undefined
    }
    return [...sectionsFromDescriptors(descriptors, settings.writable, labelLanguage), localSection()]
  }

  /** Re-project the sections into the open panel. */
  const refresh = (): void => {
    if (dialog === undefined || detached) return
    // A write's answer already carries the new revision; a concurrent
    // notification must not start a second describe mid-write.
    if (refreshing) {
      pendingRefresh = true
      return
    }
    refreshing = true
    try {
      const sections = readSections(false)
      if (sections !== undefined) dialog.setSections(sections)
    } finally {
      refreshing = false
    }
    if (pendingRefresh) {
      pendingRefresh = false
      refresh()
    }
  }

  /**
   * Coalesce configuration-change notifications into one refresh per task. The
   * Host emits one event per entry it re-projects, so a single write can arrive
   * as several; describing once per burst keeps the panel's read count flat.
   */
  const scheduleRefresh = (): void => {
    if (refreshScheduled || detached) return
    refreshScheduled = true
    queueMicrotask(() => {
      refreshScheduled = false
      refresh()
    })
  }

  /** Apply one edit from the panel, then refresh it. */
  const commit = async (section: SettingsSection, field: SettingsFieldSpec, value: unknown | undefined): Promise<void> => {
    if (section.kind === 'local') {
      if (value === undefined) return
      // Session rows are addressed by path: the display label is translated and
      // must never decide which setter runs.
      if (fieldLabel(field) === 'showReasoning') deps.applyLocal({ showReasoning: value === true })
      else if (fieldLabel(field) === 'toolCards' && typeof value === 'string') {
        deps.applyLocal({ toolCards: value as ToolCardVisibility })
      }
      refresh()
      return
    }
    const settings = settingsService(ctx)
    if (settings === undefined) {
      dialog?.setError(translator.t('settings.becameUnavailable'))
      return
    }
    const op: SettingsPathOp = value === undefined
      ? { op: 'unset', path: field.path }
      : { op: 'set', path: field.path, value }
    const label = displayInlineText(field.label)
    const sectionName = displayInlineText(section.title)
    try {
      await settings.mutate(section.id, [op], section.revision)
      deps.appendNotice(translator.t('settings.updated', { field: label, section: sectionName }))
    } catch (error) {
      const failure = settingsWriteError(error, translator.t)
      dialog?.setError(failure)
      deps.appendNotice(translator.t('settings.updateFailed', { field: label, error: failure }), 'error')
    }
    refresh()
  }

  const disposeChanges = onSettingsChange(ctx, () => { scheduleRefresh() })

  return {
    open(raw: string): void {
      const requested = raw.trim()
      const sections = readSections(true)
      if (sections === undefined) return
      // The panel still opens: the session-local group is always editable even
      // when this profile exposes no Host entry.
      if (sections.length === 1) {
        deps.appendNotice(translator.t('settings.noLiveEntry'), 'warning')
      }
      const known = requested === ''
        ? undefined
        : sections.find(section => section.id === requested
          || section.title.toLocaleLowerCase() === requested.toLocaleLowerCase())
      if (requested !== '' && known === undefined) {
        deps.appendNotice(
          translator.t('settings.unknownNamespace', {
            namespace: displayInlineText(requested),
            known: sections
              .map(section => `${displayInlineText(section.title)} (${section.id})`)
              .join(', '),
          }),
          'warning',
        )
        return
      }
      void overlay?.close()
      const settings = settingsService(ctx)
      const session = overlayManager.open({
        create: (host) => {
          const panel = new SettingsDialog(
            sections,
            {
              palette,
              maxFields: resolved.maxSettingsFields,
              documentLabel: settings === undefined
                ? ''
                : translator.t('settings.document', { path: settings.documentPath }),
              translator,
              commit,
              close: () => { host.close() },
            },
            known?.id,
          )
          dialog = panel
          return panel
        },
        options: {
          width: resolved.settingsDialogWidth,
          maxHeight: resolved.settingsDialogMaxHeight,
          anchor: 'center',
          margin: 1,
        },
      })
      overlay = session
      void session.closed.then(() => {
        // A newer panel may already own these slots; only the closing session's
        // own references are cleared.
        if (overlay !== session) return
        overlay = undefined
        dialog = undefined
      })
      deps.requestRender()
    },
    detach(): void {
      detached = true
      disposeChanges()
      dialog = undefined
      overlay = undefined
    },
  }
}
