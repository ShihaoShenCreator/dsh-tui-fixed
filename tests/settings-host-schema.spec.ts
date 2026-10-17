/**
 * Guard against descriptor-shape drift on a real plugin schema.
 *
 * The Host hands the terminal `volatileForm(schema).toJSON()`, a form schema
 * whose `meta.volatile` markers were already stripped (`plainSchema` deletes
 * them). This suite takes a real profile plugin's Config schema, rebuilds that
 * exact projection, and asserts the terminal projection still finds its fields —
 * the failure mode a marker-based selection produced was an empty panel.
 */

import { describe, expect, it } from 'vitest'
import z from '@deepseek-ai/schemastery'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { editableFields, fieldLabel, rehydrateSchema } from '../src/settings/schema-form.ts'
import { TuiConfigSchema } from '../src/config.ts'

/** Copy of the Host's `plainSchema`: strip the markers a form never carries. */
function plainSchema(schema: z): z {
  const result = new z(schema.toJSON())
  const walk = (node: z): void => {
    Reflect.deleteProperty(node.meta, 'volatile')
    if (node.meta.role === 'secret') {
      Reflect.deleteProperty(node.meta, 'default')
      Reflect.deleteProperty(node.meta, 'required')
    }
    for (const child of Object.values((node.dict ?? {}) as Record<string, z>)) walk(child)
    if (node.inner !== undefined) walk(node.inner)
    for (const child of node.list ?? []) walk(child)
  }
  walk(result)
  return result
}

/** Copy of the Host's `volatileForm`: keep only the live-editable subtree. */
function volatileForm(schema: z): z | undefined {
  if (Reflect.get(schema.meta, 'volatile') === true) return plainSchema(schema)
  if (schema.type !== 'object') return undefined
  const dict = Object.fromEntries(Object.entries((schema.dict ?? {}) as Record<string, z>).flatMap(([key, child]) => {
    const field = volatileForm(child)
    return field === undefined ? [] : [[key, field]]
  }))
  return Object.keys(dict).length === 0 ? undefined : z.object(dict)
}

describe('real Host form projection', () => {
  it('finds the live field of a plugin Config after the Host strips its markers', () => {
    const schema = (AgentLoop as unknown as { Config: z }).Config
    const form = volatileForm(schema)
    expect(form, 'agent-loop declares a live field').toBeDefined()
    const envelope = JSON.parse(JSON.stringify((form as z).toJSON())) as unknown
    // The wire envelope is marker-free; this is what broke a marker filter.
    expect(JSON.stringify(envelope)).not.toContain('"volatile"')
    const fields = editableFields(rehydrateSchema(envelope)).map(fieldLabel)
    expect(fields).toEqual(['maxParallelToolCalls'])
  })

  it('keeps nested live fields reachable by a dotted path', () => {
    const schema = z.object({
      outer: z.object({ inner: z.number().default(1).volatile() }),
      live: z.string().volatile(),
    })
    const form = volatileForm(schema)
    const envelope = JSON.parse(JSON.stringify((form as z).toJSON())) as unknown
    expect(editableFields(rehydrateSchema(envelope)).map(fieldLabel)).toEqual(['outer.inner', 'live'])
  })

  it('exposes exactly one live field on the TUI entry: the interface language', () => {
    // `/settings` can only switch the language because `locale` is the `tui`
    // entry's one volatile field. A second live field appearing here, or the
    // marker disappearing, would silently take the Language row away.
    const form = volatileForm(TuiConfigSchema)
    expect(form, 'the tui entry declares a live field').toBeDefined()
    const envelope = JSON.parse(JSON.stringify((form as z).toJSON())) as unknown
    // The wire envelope is marker-free; that is what the panel reads.
    expect(JSON.stringify(envelope)).not.toContain('"volatile"')
    const fields = editableFields(rehydrateSchema(envelope))
    expect(fields.map(fieldLabel)).toEqual(['locale'])
    // The panel offers the three accepted settings and cycles them on Enter.
    expect(fields[0]).toMatchObject({ kind: 'enum', enumValues: ['auto', 'en', 'zh'] })
    expect(fields[0]?.enumLabels?.length).toBe(3)
  })
})
