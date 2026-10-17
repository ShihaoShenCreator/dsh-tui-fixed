/**
 * Pure projection rules behind `/settings`: field selection from the Host's
 * projected form schema, value formatting, and write-time validation.
 */

import { describe, expect, it } from 'vitest'
import z from '@deepseek-ai/schemastery'
import {
  editText,
  editableFields,
  fieldLabel,
  formatField,
  hasPath,
  isOverridden,
  parseField,
  readPath,
  rehydrateSchema,
  sectionsFromDescriptors,
  type SettingsDescriptorView,
  type SettingsSection,
} from '../src/settings/schema-form.ts'
import { createTranslator } from '../src/i18n/translate.ts'

const { t } = createTranslator('en')

/** Serialize a schema exactly as the Host's descriptor carries it. */
function envelope(schema: z): unknown {
  return JSON.parse(JSON.stringify(schema.toJSON())) as unknown
}

describe('settings schema projection', () => {
  it('takes every leaf of the projected form schema', () => {
    // What `describe()` returns: the live subtree only, with `meta.volatile`
    // already stripped. Object properties are walked; other nodes are leaves.
    const form = z.object({
      live: z.number().min(1).default(3).description('how many'),
      nested: z.object({ inner: z.boolean().default(false) }),
      wholesale: z.object({ a: z.string() }),
      list: z.array(z.string()).default([]),
    })
    const fields = editableFields(rehydrateSchema(envelope(form)))
    expect(fields.map(fieldLabel)).toEqual(['live', 'nested.inner', 'wholesale.a', 'list'])
    expect(fields[0]?.kind).toBe('number')
    expect(fields[0]?.description).toBe('how many')
    expect(fields[1]?.kind).toBe('boolean')
    expect(fields[2]?.kind).toBe('string')
    expect(fields[3]?.kind).toBe('json')
  })

  it('treats a projected array or dict node as one JSON leaf', () => {
    const fields = editableFields(rehydrateSchema(envelope(z.object({
      rows: z.array(z.object({ name: z.string() })).default([]),
      bag: z.dict(z.number()).default({}),
    }))))
    expect(fields.map(field => ({ label: fieldLabel(field), kind: field.kind })))
      .toEqual([{ label: 'rows', kind: 'json' }, { label: 'bag', kind: 'json' }])
  })

  it('classifies unions of constants as enums and hides hidden leaves', () => {
    const form = z.object({
      mode: z.union(['fast', 'slow']).default('fast'),
      hidden: z.string().hidden(),
      off: z.boolean().disabled(),
    })
    const fields = editableFields(rehydrateSchema(envelope(form)))
    expect(fields.map(fieldLabel)).toEqual(['mode', 'off'])
    expect(fields[0]).toMatchObject({ kind: 'enum', enumValues: ['fast', 'slow'] })
    expect(fields[1]?.readOnly).toBe(true)
  })

  it('formats values per kind and marks unset ones', () => {
    const value = { flag: true, mode: 'fast', count: 4, text: 'a\nb', tree: { nested: [1, 2] } }
    const field = (kind: 'boolean' | 'enum' | 'number' | 'string' | 'json', path: string[]) =>
      ({ path, kind }) as const
    expect(formatField({ ...field('boolean', ['flag']) }, value, t)).toBe('on')
    expect(formatField({ ...field('enum', ['mode']) }, value, t)).toBe('fast')
    expect(formatField({ ...field('number', ['count']) }, value, t)).toBe('4')
    expect(formatField({ ...field('string', ['text']) }, value, t)).toBe('a b')
    expect(formatField({ ...field('json', ['tree']) }, value, t)).toBe('{"nested":[1,2]}')
    expect(formatField({ ...field('boolean', ['absent']) }, value, t)).toBe('(unset)')
    expect(formatField({ path: ['token'], kind: 'string', secret: true, secretSet: true }, value, t)).toBe('(set)')
    expect(formatField({ path: ['token'], kind: 'string', secret: true, secretSet: false }, value, t)).toBe('(unset)')
  })

  it('reads and detects paths by presence, not by value', () => {
    expect(readPath({ a: { b: 1 } }, ['a', 'b'])).toBe(1)
    expect(readPath({ a: 1 }, ['a', 'b'])).toBeUndefined()
    expect(hasPath({ a: { b: undefined } }, ['a', 'b'])).toBe(true)
    expect(hasPath({ a: {} }, ['a', 'b'])).toBe(false)
    expect(hasPath({ a: 1 }, ['a'])).toBe(true)
  })

  it('parses and validates against the field schema', () => {
    const schema = z.object({
      count: z.number().min(1).volatile(),
      flag: z.boolean().volatile(),
      mode: z.union(['fast', 'slow']).volatile(),
      label: z.string().volatile(),
      tree: z.object({ a: z.string() }).volatile(),
    })
    const root = rehydrateSchema(envelope(schema))
    const field = (kind: 'boolean' | 'enum' | 'number' | 'string' | 'json', path: string[], enumValues?: string[]) =>
      ({ path, kind, ...enumValues === undefined ? {} : { enumValues } }) as const

    expect(parseField(root, { ...field('number', ['count']) }, '7', t)).toEqual({ ok: true, value: 7 })
    expect(parseField(root, { ...field('number', ['count']) }, '0', t).ok).toBe(false)
    expect(parseField(root, { ...field('number', ['count']) }, 'soon', t).ok).toBe(false)
    expect(parseField(root, { ...field('number', ['count']) }, '', t)).toEqual({ ok: false, error: 'Enter a number.' })
    expect(parseField(root, { ...field('boolean', ['flag']) }, 'on', t)).toEqual({ ok: true, value: true })
    expect(parseField(root, { ...field('boolean', ['flag']) }, 'maybe', t).ok).toBe(false)
    expect(parseField(root, { ...field('enum', ['mode'], ['fast', 'slow']) }, 'slow', t)).toEqual({ ok: true, value: 'slow' })
    expect(parseField(root, { ...field('enum', ['mode'], ['fast', 'slow']) }, 'medium', t).ok).toBe(false)
    expect(parseField(root, { ...field('string', ['label']) }, '', t)).toEqual({ ok: true, value: '' })
    expect(parseField(root, { ...field('json', ['tree']) }, '{"a":"b"}', t)).toEqual({ ok: true, value: { a: 'b' } })
    expect(parseField(root, { ...field('json', ['tree']) }, '{', t).ok).toBe(false)
    expect(parseField(root, { ...field('json', ['tree']) }, '[]', t).ok).toBe(false)
  })

  it('prefills the editing text', () => {
    expect(editText({ path: ['a'], kind: 'string' }, { a: 'x' })).toBe('x')
    expect(editText({ path: ['a'], kind: 'json' }, { a: { b: 1 } })).toBe('{"b":1}')
    expect(editText({ path: ['a'], kind: 'json' }, {})).toBe('')
    expect(editText({ path: ['a'], kind: 'string', secret: true }, { a: 'hidden' })).toBe('')
  })
})

describe('settings sections', () => {
  const descriptor = (overrides: Partial<SettingsDescriptorView>): SettingsDescriptorView => ({
    ns: 'entry',
    // Form schema as `describe()` returns it: the live subtree with no markers.
    schema: envelope(z.object({ count: z.number().default(1), token: z.string().role('secret') })),
    value: { count: 5 },
    user: { count: 5 },
    revision: 3,
    autoGenerate: true,
    secrets: [{ path: ['token'], set: true }],
    ...overrides,
  })

  it('builds one section per configurable entry, including bespoke-page ones', () => {
    const sections = sectionsFromDescriptors([
      descriptor({ ns: 'b-entry' }),
      descriptor({ ns: 'a-entry', secrets: [{ path: ['token'], set: false }] }),
      // A plugin that registers its own browser page still exposes live fields
      // here: the terminal has no such page, so the generated form is the only
      // surface those fields can have.
      descriptor({ ns: 'manual', autoGenerate: false }),
    ], true)
    // Sections sort by display title, not by entry id.
    expect(sections.map(section => section.id)).toEqual(['a-entry', 'b-entry', 'manual'])
    expect(sections.every(section => section.title !== section.id)).toBe(true)
    expect(sections[0]?.title).toBe('A entry')
    expect(sections[0]?.root).toBeDefined()
    expect(sections[0]?.fields.map(fieldLabel)).toEqual(['count', 'token'])
    expect(sections[0]?.fields.map(field => field.label)).toEqual(['Count', 'Token'])
    expect(sections[0]?.fields[1]).toMatchObject({ secret: true, secretSet: false })
    expect(sections[1]?.fields[1]).toMatchObject({ secret: true, secretSet: true })
    expect(sections.every(section => section.writable)).toBe(true)
  })

  it('renders curated names when the entry and field are known', () => {
    const sections = sectionsFromDescriptors([
      descriptor({
        ns: 'pwsh-sandbox',
        schema: envelope(z.object({ timeoutMs: z.number(), maxSpillBytes: z.number() })),
      }),
    ], true, 'zh')
    expect(sections[0]?.title).toBe('PowerShell 沙箱执行')
    expect(sections[0]?.fields.map(field => field.label)).toEqual(['超时（毫秒）', '溢出上限（字节）'])
  })

  it('drops only entries whose schema cannot be rehydrated', () => {
    // The Host's `describe()` only reports entries whose form schema has at
    // least one live field, so a projected form always yields leaves; the one
    // recoverable case is an envelope this build cannot read at all.
    const sections = sectionsFromDescriptors([
      descriptor({ ns: 'plain', schema: envelope(z.object({ only: z.string() })) }),
      descriptor({ ns: 'broken', schema: 'not a schema envelope' }),
    ], false)
    expect(sections.map(section => section.id)).toEqual(['plain'])
    expect(sections[0]?.fields.map(fieldLabel)).toEqual(['only'])
    expect(sections[0]?.writable).toBe(false)
  })

  it('reports overrides by presence in the user layer', () => {
    const section: SettingsSection = {
      id: 'entry',
      title: 'entry',
      kind: 'host',
      revision: 0,
      value: { count: 1, mode: 'fast' },
      user: { count: 1 },
      writable: true,
      fields: [],
    }
    expect(isOverridden(section, { path: ['count'], kind: 'number' })).toBe(true)
    expect(isOverridden(section, { path: ['mode'], kind: 'enum' })).toBe(false)
  })
})
