/**
 * Project one Host settings descriptor into the flat field list the terminal
 * settings panel edits, and parse/format the values it writes back.
 *
 * The Host's `settings` service exposes one descriptor per profile plugin entry
 * whose Config declares live-editable fields: `schema` is the serialized form
 * envelope (`volatileForm(schema).toJSON()`, already restricted to the live
 * subtree and stripped of its markers), while `value`, `base`, and `user` are
 * the resolved, composition-base, and raw-user layers projected through that
 * same form. The panel therefore renders exactly the fields the Host offered
 * and never invents a second notion of writability.
 * @module @shihaoshen/dsh-tui-fixed/settings/schema-form
 */

import Schema from '@deepseek-ai/schemastery'
import {
  enumLabel as localizeEnum,
  fieldName,
  sectionTitle,
  type LabelLanguage,
} from './labels.ts'
import type { Translator } from '../i18n/translate.ts'

/**
 * Structural view of one live Schemastery node. Only the relations the
 * projection walks are named; the serialized envelope also carries `uid` and a
 * `refs` table that `new Schema()` resolves back into these links.
 */
export interface SchemaNode {
  type?: string
  meta?: {
    default?: unknown
    description?: string
    role?: string
    hidden?: boolean
    disabled?: boolean
    min?: number
    max?: number
    step?: number
  }
  dict?: Record<string, SchemaNode>
  inner?: SchemaNode
  list?: SchemaNode[]
  value?: unknown
}

/** How the panel edits one field. */
export type SettingsFieldKind = 'boolean' | 'enum' | 'number' | 'string' | 'json'

/** One editable leaf inside a settings section. */
export interface SettingsFieldSpec {
  /** Path from the section root; a single key for ordinary fields. */
  readonly path: readonly string[]
  /** Human-readable name rendered in the panel; never used to write. */
  readonly label: string
  /** How values are formatted, parsed, and interacted with. */
  readonly kind: SettingsFieldKind
  /** Allowed values for {@link SettingsFieldKind} `enum`, display-shaped. */
  readonly enumValues?: readonly (string | number)[]
  /** Allowed values rendered for display, parallel to {@link enumValues}. */
  readonly enumLabels?: readonly string[]
  /** Host schema description, shown under the selected row. */
  readonly description?: string
  /** Write-only slot: the Host never returns the value. */
  readonly secret?: boolean
  /** Whether the Host already holds a value for a {@link secret} slot. */
  readonly secretSet?: boolean
  /** Declared non-editable by the plugin; shown but not writable. */
  readonly readOnly?: boolean
}

/** One settings page: a Host plugin entry, or the session-local TUI group. */
export interface SettingsSection {
  /** Stable identity: the Host namespace, or the local group id. */
  readonly id: string
  /** Row label in the section switch: a display name, not the entry id. */
  readonly title: string
  /** Whether writes go to the profile document or to this session only. */
  readonly kind: 'host' | 'local'
  /** Host revision this section was read at; the fence for its next write. */
  readonly revision: number
  /** Redacted resolved value (schema defaults, composition base, user layer). */
  readonly value: unknown
  /** Raw user layer; a field's presence here marks it a user override. */
  readonly user: unknown
  /** Whether this section accepts writes. */
  readonly writable: boolean
  /** Rehydrated schema root; absent for session-local sections. */
  readonly root?: SchemaNode
  /** Editable leaves, in schema declaration order. */
  readonly fields: readonly SettingsFieldSpec[]
}

/** One Host entry as the settings service reports it (redacted read). */
export interface SettingsDescriptorView {
  readonly ns: string
  readonly schema: unknown
  readonly value: unknown
  readonly base?: unknown
  readonly user?: unknown
  readonly revision: number
  /** Whether a configuration UI may generate a page for this entry. */
  readonly autoGenerate: boolean
  /** Schema-declared secret slots and whether each currently holds a value. */
  readonly secrets?: readonly { readonly path: readonly string[]; readonly set: boolean }[]
}

/** Path rendered for one field: its segments, dot-joined. Used to write, and to re-find a row across refreshes. */
export function fieldLabel(field: SettingsFieldSpec): string {
  return field.path.join('.')
}

/**
 * Rehydrate a serialized schema envelope.
 * @param envelope - `Schema.toJSON()` output carried by a settings descriptor.
 * @returns The live schema root.
 */
export function rehydrateSchema(envelope: unknown): SchemaNode {
  return new Schema(envelope as never) as unknown as SchemaNode
}

/** Whether two paths address the same field. */
export function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index])
}

/** The display form of one enum member. */
function enumLabel(node: SchemaNode): string | number | undefined {
  const value: unknown = node.value
  if (typeof value === 'string' || typeof value === 'number') return value
  return undefined
}

/** Classify one leaf node into the panel's editing kinds. */
function kindOf(node: SchemaNode): { kind: SettingsFieldKind; enumValues?: readonly (string | number)[] } {
  if (node.type === 'boolean') return { kind: 'boolean' }
  if (node.type === 'number' || node.type === 'natural' || node.type === 'percent') return { kind: 'number' }
  if (node.type === 'string') return { kind: 'string' }
  if (node.type === 'union') {
    const members = (node.list ?? []).map(enumLabel)
    if (members.length > 0 && members.every((member): member is string | number => member !== undefined)) {
      return { kind: 'enum', enumValues: members }
    }
  }
  return { kind: 'json' }
}

/**
 * Flatten a descriptor's form schema into editable leaves.
 *
 * `describe()` hands back `volatileForm(schema).toJSON()`: the Host already
 * selected the live-editable subtree and stripped every `meta.volatile` marker
 * (`plainSchema` deletes them, so a form never carries the flag that produced
 * it). Filtering on `meta.volatile` here would therefore drop every field. What
 * remains is authoritative — object properties are walked, and every other node
 * is one leaf. Writing a nested path stays legal: the Host's `isVolatilePath`
 * checks the ORIGINAL schema, where the projected node's ancestor still carries
 * the marker.
 * @param schema - Form schema root or nested node.
 * @param path - Path accumulated from the section root.
 * @param language - Language for the field's display name.
 * @param local - Whether the leaves belong to the panel's session group.
 * @returns The editable leaves in declaration order.
 */
export function editableFields(
  schema: SchemaNode,
  path: readonly string[] = [],
  language: LabelLanguage = 'en',
  local = false,
): SettingsFieldSpec[] {
  const meta = schema.meta ?? {}
  if (meta.hidden === true) return []
  if (schema.type === 'object' && schema.dict !== undefined) {
    return Object.entries(schema.dict).flatMap(([key, child]) =>
      editableFields(child, [...path, key], language, local))
  }
  const kind = kindOf(schema)
  return [{
    path,
    label: fieldName(path, language, local),
    ...kind,
    ...kind.enumValues === undefined
      ? {}
      : { enumLabels: kind.enumValues.map(value => localizeEnum(String(value), language)) },
    ...meta.description === undefined ? {} : { description: meta.description },
    ...meta.role === 'secret' ? { secret: true } : {},
    ...meta.disabled === true ? { readOnly: true } : {},
  }]
}

/**
 * Read a nested value by path.
 * @param value - Container to walk.
 * @param path - Keys, in root-to-leaf order.
 * @returns The value, or `undefined` when any step is absent.
 */
export function readPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Whether a path exists in a layer, independent of the value it holds. The
 * Host marks a field overridden by PRESENCE in the user layer, so an override
 * that happens to equal the composition default still counts.
 * @param value - Layer to inspect.
 * @param path - Keys, in root-to-leaf order.
 * @returns Whether every step exists.
 */
export function hasPath(value: unknown, path: readonly string[]): boolean {
  if (path.length === 0) return value !== undefined
  let current: unknown = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return false
    if (!Object.hasOwn(current, key)) return false
    current = (current as Record<string, unknown>)[key]
  }
  return true
}

/** Collapse a multi-line string into one displayable line. */
function singleLine(text: string): string {
  return text.replace(/[\r\n]+/gu, ' ')
}

/**
 * Render one field's current value as the row's right-hand text.
 * @param field - Field being rendered.
 * @param value - Resolved section value.
 * @param t - Translator supplying the placeholder words (`unset`, `on`, `off`).
 * @returns The display text.
 */
export function formatField(field: SettingsFieldSpec, value: unknown, t: Translator['t']): string {
  const unset = t('settings.value.unset')
  if (field.secret === true) return field.secretSet === true ? t('settings.value.set') : unset
  const current = readPath(value, field.path)
  switch (field.kind) {
    case 'boolean':
      if (current === undefined) return unset
      return t(current === true ? 'settings.value.on' : 'settings.value.off')
    case 'enum':
      if (current === undefined) return unset
      // Show the translated member when one exists; the stored value never
      // changes, so the label is display-only.
      return field.enumLabels?.[(field.enumValues ?? []).findIndex(option => String(option) === String(current))]
        ?? (typeof current === 'string' ? singleLine(current) : String(current))
    case 'number':
    case 'string':
      if (current === undefined) return unset
      if (typeof current === 'string') return singleLine(current)
      return String(current)
    case 'json':
      if (current === undefined) return unset
      try {
        return singleLine(JSON.stringify(current))
      } catch {
        return t('settings.value.unserializable')
      }
  }
}

/** Rejection text for a value the profile document could not store faithfully. */
function jsonShapeError(value: unknown, t: Translator['t'], path = '$'): string | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return undefined
  if (typeof value === 'number') {
    return Number.isFinite(value) ? undefined : t('settings.error.finiteNumber', { path })
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const failure = jsonShapeError(entry, t, `${path}[${index}]`)
      if (failure !== undefined) return failure
    }
    return undefined
  }
  if (typeof value === 'object') {
    const proto: unknown = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return t('settings.error.notPlainObject', { path })
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const failure = jsonShapeError(entry, t, `${path}.${key}`)
      if (failure !== undefined) return failure
    }
    return undefined
  }
  return t('settings.error.typeOf', { path, type: typeof value })
}

/** Resolve the schema node addressed by a field path. */
function nodeAtPath(root: SchemaNode, path: readonly string[]): SchemaNode | undefined {
  let node: SchemaNode | undefined = root
  for (const key of path) {
    if (node === undefined) return undefined
    node = node.type === 'object' ? node.dict?.[key] : undefined
  }
  return node
}

/** Validate one candidate value against the field's own schema node. */
function schemaError(root: SchemaNode, field: SettingsFieldSpec, value: unknown): string | undefined {
  const node = nodeAtPath(root, field.path)
  if (node === undefined) return undefined
  try {
    ;(node as unknown as (input: unknown) => unknown)(value)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** One parsed field edit ready to become a Host path operation. */
export type ParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string }

/**
 * Parse one typed field value, then validate it the way the Host would: JSON
 * data only (the profile document round-trips through YAML), and the field's
 * own schema node must accept it.
 * @param root - Rehydrated schema root of the section.
 * @param field - Field being written.
 * @param text - Raw input text.
 * @param t - Translator supplying the rejection copy.
 * @returns The parsed value, or a message explaining the rejection.
 */
export function parseField(
  root: SchemaNode,
  field: SettingsFieldSpec,
  text: string,
  t: Translator['t'],
): ParseResult {
  let value: unknown
  switch (field.kind) {
    case 'number': {
      const trimmed = text.trim()
      if (trimmed === '') return { ok: false, error: t('settings.error.enterNumber') }
      const parsed = Number(trimmed)
      if (!Number.isFinite(parsed)) {
        return { ok: false, error: t('settings.error.notNumber', { text: trimmed }) }
      }
      value = parsed
      break
    }
    case 'string':
      value = text
      break
    case 'json':
      try {
        value = JSON.parse(text) as unknown
      } catch (error) {
        return {
          ok: false,
          error: t('settings.error.invalidJson', {
            error: error instanceof Error ? error.message : String(error),
          }),
        }
      }
      break
    case 'boolean':
    case 'enum':
      if (field.kind === 'boolean') {
        if (text === 'on' || text === 'true') value = true
        else if (text === 'off' || text === 'false') value = false
        else return { ok: false, error: t('settings.error.enterOnOff') }
      } else {
        const member = (field.enumValues ?? []).find(option => String(option) === text)
        if (member === undefined) {
          return {
            ok: false,
            error: t('settings.error.expectedOneOf', { values: (field.enumValues ?? []).join(', ') }),
          }
        }
        value = member
      }
      break
  }
  const shapeFailure = jsonShapeError(value, t)
  if (shapeFailure !== undefined) return { ok: false, error: t('settings.error.notStorable', { error: shapeFailure }) }
  const failure = schemaError(root, field, value)
  if (failure !== undefined) return { ok: false, error: failure }
  return { ok: true, value }
}

/** The editing text prefilled when a field enters edit mode. */
export function editText(field: SettingsFieldSpec, value: unknown): string {
  if (field.secret === true) return ''
  const current = readPath(value, field.path)
  if (current === undefined) return ''
  if (typeof current === 'string') return current
  if (field.kind === 'json') return JSON.stringify(current)
  return String(current)
}

/** Whether a section's field carries a user override. */
export function isOverridden(section: SettingsSection, field: SettingsFieldSpec): boolean {
  return hasPath(section.user, field.path)
}

/**
 * Build sections from a settings describe answer.
 *
 * `autoGenerate` is deliberately ignored. The Host sets it to `false` for
 * entries whose plugin ships a bespoke browser page (`ui-theme` fonts,
 * `ui-chat` transcript view, `agent-default-model`, `permission-presets`,
 * `llm-pi-ai`, …); that page is a React component with no terminal twin, and
 * several of those entries (default model route, permission preset, custom
 * providers) are exactly what a terminal user needs to edit. A generated form
 * is the only terminal surface they can have, so every entry with at least one
 * live-editable field gets one.
 * @param descriptors - Redacted descriptors read from the Host.
 * @param writable - Whether the active profile accepts writes.
 * @param language - Language for section and field display names.
 * @returns One section per configurable entry, sorted by namespace.
 */
export function sectionsFromDescriptors(
  descriptors: readonly SettingsDescriptorView[],
  writable: boolean,
  language: LabelLanguage = 'en',
): SettingsSection[] {
  return descriptors
    .flatMap((descriptor): SettingsSection[] => {
      let root: SchemaNode
      try {
        root = rehydrateSchema(descriptor.schema)
      } catch {
        // An envelope this build cannot rehydrate vouches for no fields.
        return []
      }
      // `new Schema()` accepts any input and reports an untyped node for a
      // malformed envelope instead of throwing, so a missing type is the real
      // signal that this descriptor carries no usable form.
      if (typeof root.type !== 'string') return []
      const secrets = descriptor.secrets ?? []
      const fields = editableFields(root, [], language).map((field): SettingsFieldSpec => {
        if (field.secret !== true) return field
        const slot = secrets.find(secret => samePath(secret.path, field.path))
        return { ...field, secretSet: slot?.set === true }
      })
      if (fields.length === 0) return []
      return [{
        id: descriptor.ns,
        title: sectionTitle(descriptor.ns, language),
        kind: 'host',
        revision: descriptor.revision,
        value: descriptor.value,
        user: descriptor.user,
        writable,
        root,
        fields,
      }]
    })
    .sort((left, right) => left.title.localeCompare(right.title))
}
