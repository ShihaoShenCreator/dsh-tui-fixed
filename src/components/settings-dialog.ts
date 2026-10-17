/**
 * Keyboard-driven settings panel for the terminal front door.
 *
 * One page per Host plugin entry that exposes live-editable fields, plus the
 * session-local group the front door owns. Values arrive already projected and
 * redacted; this component only formats, navigates, and hands edits back to the
 * controller that owns the Host write, so it never holds a secret.
 * @module @shihaoshen/dsh-tui-fixed/components/settings-dialog
 */

import {
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
} from '@earendil-works/pi-tui'
import { displayInlineText, displayText } from './text.ts'
import { renderDialog } from './dialogs.ts'
import type { Palette } from './theme.ts'
import {
  editText,
  fieldLabel,
  formatField,
  isOverridden,
  parseField,
  readPath,
  type SettingsFieldSpec,
  type SettingsSection,
} from '../settings/schema-form.ts'
import type { TranslationKey, Translator, TParams } from '../i18n/translate.ts'

/**
 * Whether one input sequence starts replacing a seeded field value: a printable
 * character or paste, as opposed to cursor motion, deletion, or a control key
 * that edits the seed in place.
 * @param data - Raw terminal input sequence.
 * @returns Whether the seed should be cleared first.
 */
function replacesSeed(data: string): boolean {
  if (data.length === 0) return false
  // Escape-led sequences are cursor/function keys, never text.
  if (data.startsWith('\u001B')) return false
  // Control bytes (backspace, Ctrl+U, Ctrl+E, …) edit the existing value.
  for (const character of data) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

/**
 * Parse a session-local row. Local rows carry no Host schema, so only the two
 * kinds that cannot fail a schema check (boolean and enum) exist here.
 */
function parseLocal(
  field: SettingsFieldSpec,
  text: string,
  t: Translator['t'],
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (field.kind === 'boolean') {
    if (text === 'on' || text === 'true') return { ok: true, value: true }
    if (text === 'off' || text === 'false') return { ok: true, value: false }
    return { ok: false, error: t('settings.error.enterOnOff') }
  }
  const values = field.enumValues ?? []
  const member = values.find(option => String(option) === text)
  return member === undefined
    ? { ok: false, error: t('settings.error.expectedOneOf', { values: values.join(', ') }) }
    : { ok: true, value: member }
}

/** Label column bounds, in terminal columns. */
const MIN_LABEL_WIDTH = 12
const MAX_LABEL_WIDTH = 30

/** Collaborators the panel needs from its owner. */
export interface SettingsDialogDeps {
  readonly palette: Palette
  /** Visible field rows; the selected row always stays inside the window. */
  readonly maxFields: number
  /** Footer text naming where host writes persist; empty hides the line. */
  readonly documentLabel: string
  /** Locale-bound translator the panel renders its chrome through. */
  readonly translator: Translator
  /**
   * Hand one edit to the owner, which performs the write and then installs the
   * refreshed sections (or an error) on this panel.
   * @param section - Section the field belongs to.
   * @param field - Field being written.
   * @param value - Parsed value, or `undefined` to clear the override.
   */
  readonly commit: (
    section: SettingsSection,
    field: SettingsFieldSpec,
    value: unknown | undefined,
  ) => Promise<void>
  /** Close the panel. */
  readonly close: () => void
}

/**
 * Settings panel: a section strip, one window of field rows, and an inline
 * editor for the selected row.
 *
 * Keys: ↑/↓ select, ←/→ or Tab switch sections, Enter edit (or flip a boolean /
 * cycle an enum), r reset the selected override, Esc cancel edit then close,
 * Ctrl+C close.
 */
export class SettingsDialog implements Component, Focusable {
  private sections: readonly SettingsSection[]
  private sectionIndex: number
  private fieldIndex = 0
  private editing: { field: SettingsFieldSpec; input: Input; seeded: boolean } | undefined
  private error = ''
  private busy = false
  focused = false

  constructor(
    sections: readonly SettingsSection[],
    private readonly deps: SettingsDialogDeps,
    initialSectionId?: string,
  ) {
    this.sections = sections
    const requested = initialSectionId === undefined
      ? -1
      : sections.findIndex(section => section.id === initialSectionId)
    this.sectionIndex = Math.max(0, requested)
  }

  /** One chrome string in the panel's language. */
  private text(key: TranslationKey, values?: TParams): string {
    return this.deps.translator.t(key, values)
  }

  private get palette(): Palette {
    return this.deps.palette
  }

  private get section(): SettingsSection | undefined {
    return this.sections[this.sectionIndex]
  }

  private get field(): SettingsFieldSpec | undefined {
    return this.section?.fields[this.fieldIndex]
  }

  /**
   * Replace the rendered sections after a successful write or an external
   * change, keeping the selection on the same field where it still exists.
   * @param sections - Freshly projected sections.
   */
  setSections(sections: readonly SettingsSection[]): void {
    const sectionId = this.section?.id
    const fieldPath = this.field === undefined ? undefined : fieldLabel(this.field)
    this.sections = sections
    const nextSection = sectionId === undefined
      ? -1
      : sections.findIndex(candidate => candidate.id === sectionId)
    this.sectionIndex = Math.max(0, nextSection)
    const nextField = fieldPath === undefined
      ? -1
      : this.section?.fields.findIndex(candidate => fieldLabel(candidate) === fieldPath) ?? -1
    this.fieldIndex = Math.max(0, nextField)
    this.busy = false
    this.invalidate()
  }

  /** Show a failed write without leaving the panel. */
  setError(message: string): void {
    this.error = message
    this.busy = false
    this.invalidate()
  }

  invalidate(): void {
    this.editing?.input.invalidate()
  }

  /** Move the highlight by one row, wrapping inside the current section. */
  private moveField(delta: number): void {
    const count = this.section?.fields.length ?? 0
    if (count === 0) return
    this.fieldIndex = (this.fieldIndex + delta + count) % count
    this.error = ''
  }

  /** Switch sections, wrapping, keeping the row index inside the new section. */
  private moveSection(delta: number): void {
    if (this.sections.length === 0) return
    this.sectionIndex = (this.sectionIndex + delta + this.sections.length) % this.sections.length
    this.fieldIndex = Math.min(this.fieldIndex, Math.max(0, (this.section?.fields.length ?? 1) - 1))
    this.error = ''
  }

  /** Explain why the highlighted row cannot be written here. */
  private refusal(section: SettingsSection, field: SettingsFieldSpec): string | undefined {
    if (section.kind === 'local') return field.readOnly === true ? this.text('settings.error.sessionStateOnly') : undefined
    if (!section.writable) return this.text('settings.error.profileReadOnly')
    if (field.readOnly === true) return this.text('settings.error.readOnlyField')
    return undefined
  }

  /** Start editing the highlighted row in a one-line input. */
  private beginEdit(field: SettingsFieldSpec, section: SettingsSection): void {
    const refusal = this.refusal(section, field)
    if (refusal !== undefined) {
      this.error = refusal
      return
    }
    const input = new Input()
    const seed = editText(field, section.value)
    input.setValue(seed)
    // pi-tui's Input keeps the cursor at its start after `setValue`, so typing
    // would insert ahead of the value (`120000` + `9` = `9120000`). A seeded
    // field therefore replaces its whole value on the first printable key, the
    // way a form's pre-selected text behaves; any edit key first cancels that
    // and edits the seed in place.
    // The cursor is moved to the end so an in-place edit and the caret agree.
    if (seed !== '') input.handleInput('\x05')
    input.onSubmit = (text) => {
      // A secret is never re-read, so an empty box means "clear the stored
      // value" rather than "store an empty string".
      if (field.secret === true && text === '') {
        this.editing = undefined
        this.error = ''
        void this.apply(section, field, undefined)
        return
      }
      const root = section.root
      const parsed = root === undefined ? parseLocal(field, text, this.deps.translator.t) : parseField(root, field, text, this.deps.translator.t)
      if (parsed.ok === false) {
        this.error = parsed.error
        this.invalidate()
        return
      }
      this.editing = undefined
      this.error = ''
      void this.apply(section, field, parsed.value)
    }
    input.onEscape = () => {
      this.editing = undefined
      this.error = ''
      this.invalidate()
    }
    this.editing = { field, input, seeded: seed !== '' }
    this.error = ''
    this.invalidate()
  }

  /** Run one owner edit, holding keyboard input until it settles. */
  private async apply(section: SettingsSection, field: SettingsFieldSpec, value: unknown | undefined): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.error = ''
    this.invalidate()
    try {
      await this.deps.commit(section, field, value)
      this.busy = false
    } catch (error) {
      this.setError(error instanceof Error ? error.message : String(error))
    }
    this.invalidate()
  }

  /** Activate the highlighted row: flip, cycle, or edit. */
  private activate(): void {
    const section = this.section
    const field = this.field
    if (section === undefined || field === undefined || this.busy) return
    const refusal = this.refusal(section, field)
    if (refusal !== undefined) {
      this.error = refusal
      return
    }
    if (field.secret === true) {
      this.beginEdit(field, section)
      return
    }
    const current = readPath(section.value, field.path)
    if (field.kind === 'boolean') {
      void this.apply(section, field, current !== true)
      return
    }
    const values = field.enumValues ?? []
    if (field.kind === 'enum' && values.length > 0) {
      const index = values.findIndex(option => String(option) === String(current))
      void this.apply(section, field, values[(index + 1) % values.length])
      return
    }
    this.beginEdit(field, section)
  }

  /** Clear the highlighted row's override so it falls back to the composition base. */
  private reset(): void {
    const section = this.section
    const field = this.field
    if (section === undefined || field === undefined || this.busy) return
    if (section.kind === 'local') {
      this.error = this.text('settings.error.sessionStateOnly')
      return
    }
    // A wholly-volatile entry is addressed at the section root; the Host's
    // path grammar has no "clear the root" operation, so there is nothing to
    // revert to and the row is edited as a whole JSON document instead.
    if (field.path.length === 0) {
      this.error = this.text('settings.error.noFieldToReset')
      return
    }
    if (!isOverridden(section, field)) {
      this.error = this.text('settings.error.notOverridden')
      return
    }
    void this.apply(section, field, undefined)
  }

  handleInput(data: string): void {
    const editing = this.editing
    if (editing !== undefined) {
      if (matchesKey(data, Key.escape)) {
        this.editing = undefined
        this.error = ''
        this.invalidate()
        return
      }
      editing.input.focused = this.focused
      // The first character typed into a seeded field replaces the whole value;
      // every other key (cursor motion, backspace, yank) drops that preselection
      // and edits the seed in place, so both readings of the prefill work.
      if (editing.seeded) {
        editing.seeded = false
        if (replacesSeed(data)) editing.input.setValue('')
      }
      editing.input.handleInput(data)
      this.invalidate()
      return
    }
    if (matchesKey(data, Key.ctrl('c')) || matchesKey(data, Key.escape)) {
      this.deps.close()
      return
    }
    if (this.busy) return
    if (matchesKey(data, Key.up)) this.moveField(-1)
    else if (matchesKey(data, Key.down)) this.moveField(1)
    else if (matchesKey(data, Key.left)) this.moveSection(-1)
    else if (matchesKey(data, Key.right)) this.moveSection(1)
    else if (matchesKey(data, Key.tab)) this.moveSection(1)
    else if (matchesKey(data, Key.shift(Key.tab))) this.moveSection(-1)
    else if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) this.activate()
    else if (data === 'r' || data === 'R') this.reset()
    this.invalidate()
  }

  /**
   * A section's name, disambiguated when two entries share a display title.
   * A profile can compose two rows whose plugins carry the same upstream title;
   * the entry id then tells them apart, which a repeated title cannot.
   */
  private sectionName(section: SettingsSection): string {
    const duplicated = this.sections.filter(candidate => candidate.title === section.title).length > 1
    return duplicated ? `${section.title} (${section.id})` : section.title
  }

  /**
   * The section strip: the active page named in full, with its position and the
   * neighbours it sits between. Rendering every label does not fit once a
   * profile composes more than a few entries, so the strip reports where the
   * reader is and what ←/→ reach, and the field rows below show the page.
   */
  private renderTabs(width: number): string {
    const active = this.section
    if (active === undefined) return this.palette.dim(this.text('settings.noPlugin'))
    const position = `${this.sectionIndex + 1}/${this.sections.length}`
    const previous = this.sections[(this.sectionIndex - 1 + this.sections.length) % this.sections.length]
    const next = this.sections[(this.sectionIndex + 1) % this.sections.length]
    const head = `${this.palette.dim('‹ ')}${this.palette.bold(this.palette.accent(displayInlineText(this.sectionName(active))))}`
    const meta = this.palette.dim(`  ${position}`)
    // With one section there is no neighbour to advertise.
    if (this.sections.length < 2 || previous === undefined || next === undefined) {
      return truncateToWidth(`${head}${meta}`, width, '…')
    }
    // Two sections make the same neighbour the previous and the next one;
    // naming it twice would read as if a third page existed.
    const neighbours = previous === next
      ? displayInlineText(this.sectionName(next))
      : `${displayInlineText(this.sectionName(previous))} · ${displayInlineText(this.sectionName(next))}`
    const tail = this.palette.dim(`  ${neighbours} ›`)
    const headWidth = visibleWidth(head)
    const metaWidth = visibleWidth(meta)
    const tailWidth = visibleWidth(tail)
    if (headWidth + metaWidth + tailWidth <= width) return `${head}${meta}${tail}`
    if (headWidth + metaWidth <= width) return `${head}${meta}`
    return truncateToWidth(head, width, '…')
  }

  /** The field window, scrolled so the highlighted row stays visible. */
  private renderFields(width: number): string[] {
    const section = this.section
    if (section === undefined) return [this.palette.dim(this.text('settings.noPlugin'))]
    const fields = section.fields
    if (fields.length === 0) return [this.palette.dim(this.text('settings.noFields'))]
    const labelWidth = Math.min(
      MAX_LABEL_WIDTH,
      Math.max(MIN_LABEL_WIDTH, ...fields.map(field => visibleWidth(field.label))),
    )
    const visible = Math.max(1, this.deps.maxFields)
    const start = Math.max(0, Math.min(this.fieldIndex - Math.floor(visible / 2), fields.length - visible))
    const end = Math.min(fields.length, start + visible)
    const lines: string[] = []
    for (let index = start; index < end; index += 1) {
      const field = fields[index] as SettingsFieldSpec
      const active = index === this.fieldIndex
      const indent = active ? this.palette.accent('❯ ') : '  '
      const rawLabel = truncateToWidth(displayInlineText(field.label), labelWidth, '')
      const label = active ? this.palette.bold(rawLabel) : rawLabel
      const padded = `${label}${' '.repeat(Math.max(0, labelWidth - visibleWidth(rawLabel)))}`
      const markers = [
        ...isOverridden(section, field) ? [this.text('settings.override')] : [],
        ...field.readOnly === true ? [this.text('settings.readOnly')] : [],
      ]
      const markerText = markers.length === 0 ? '' : `  · ${markers.join(' · ')}`
      const valueWidth = Math.max(1, width - 2 - labelWidth - visibleWidth(markerText))
      const value = truncateToWidth(
        displayInlineText(formatField(field, section.value, this.deps.translator.t)),
        valueWidth,
        '…',
      )
      const styled = active ? this.palette.accent(value) : value
      lines.push(`${indent}${padded}  ${styled}${markerText === '' ? '' : this.palette.dim(markerText)}`)
    }
    if (start > 0 || end < fields.length) {
      lines.push(this.palette.dim(`  ${this.text('settings.range', { from: start + 1, to: end, total: fields.length })}`))
    }
    const selected = fields[this.fieldIndex]
    if (selected?.description !== undefined) {
      for (const line of wrapTextWithAnsi(this.palette.dim(displayText(selected.description)), width)) {
        lines.push(`  ${line}`)
      }
    }
    return lines
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 4)
    const body: string[] = [this.renderTabs(innerWidth), '', ...this.renderFields(innerWidth), '']
    const editing = this.editing
    if (editing !== undefined) {
      editing.input.focused = this.focused
      body.push(...editing.input.render(innerWidth))
      body.push(...wrapTextWithAnsi(
        this.palette.dim(this.text('settings.footerEdit')),
        innerWidth,
      ))
    } else if (this.busy) {
      body.push(this.palette.dim(this.text('settings.saving', { section: displayInlineText(this.section?.title ?? '') })))
    } else {
      body.push(this.palette.dim(this.text('settings.footer')))
      // A friendly title alone would leave the reader unable to find the row in
      // the profile document, so the entry id it edits follows.
      const active = this.section
      if (active !== undefined) {
        body.push(this.palette.dim(this.text('settings.entry', { name: displayInlineText(active.id) })))
      }
      const documentLabel = displayInlineText(this.deps.documentLabel)
      if (documentLabel !== '') body.push(this.palette.dim(documentLabel))
    }
    if (this.error !== '') {
      body.push(...wrapTextWithAnsi(this.palette.error(displayText(this.error)), innerWidth))
    }
    return renderDialog(this.text('settings.title'), body, width, this.palette)
  }
}
