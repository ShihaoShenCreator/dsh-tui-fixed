/**
 * `/settings` behaviour over a fake Host settings service: the panel's read
 * path, its write and reset paths, the session-local group, and every failure
 * mode the controller reports instead of throwing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import {
  createTuiTestHarness,
  disposeTuiTestHarness,
  type TuiHarnessOptions,
} from './harness.ts'
import { FakeTerminal } from './fake-terminal.ts'
import type { SettingsDescriptorView } from '../src/settings/schema-form.ts'

/** Serialize a schema the way the Host descriptor carries it. */
function envelope(schema: z): unknown {
  return JSON.parse(JSON.stringify(schema.toJSON())) as unknown
}

/** A Host-shaped settings service over in-memory descriptors. */
interface FakeSettings {
  writable: boolean
  documentPath: string
  descriptors: SettingsDescriptorView[]
  writes: { ns: string; ops: unknown; revision: number | undefined }[]
  describe(options?: { redactSecrets?: boolean }): readonly SettingsDescriptorView[]
  mutate(ns: string, ops: readonly unknown[], expectedRevision?: number): Promise<void>
  /** Make the next write reject with this value. */
  failWith?: unknown
}

function fakeSettings(descriptors: SettingsDescriptorView[]): FakeSettings {
  const service: FakeSettings = {
    writable: true,
    documentPath: '/home/user/.dsh/profiles/tui/cordis.patch.yml',
    descriptors,
    writes: [],
    describe: (options) => {
      if (options?.redactSecrets !== true) throw new Error('the terminal must always ask for redaction')
      return service.descriptors
    },
    mutate: async (ns, ops, expectedRevision) => {
      service.writes.push({ ns, ops, revision: expectedRevision })
      if (service.failWith !== undefined) {
        const failure = service.failWith
        service.failWith = undefined
        throw failure
      }
      applyOp(service.descriptors, ns, ops)
    },
  }
  return service
}

/** Apply one path op to a descriptor the way the Host would, bumping the revision. */
function applyOp(descriptors: SettingsDescriptorView[], ns: string, ops: readonly unknown[]): void {
  const index = descriptors.findIndex(descriptor => descriptor.ns === ns)
  const descriptor = descriptors[index]
  if (descriptor === undefined) throw new Error(`settings namespace "${ns}" changed since it was read (expected revision 0, now 1)`)
  let value = structuredClone(descriptor.value) as Record<string, unknown>
  let user = structuredClone(descriptor.user ?? {}) as Record<string, unknown>
  for (const raw of ops) {
    const op = raw as { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }
    const [key, ...rest] = op.path
    if (key === undefined) continue
    if (op.op === 'unset') {
      if (rest.length === 0) {
        Reflect.deleteProperty(user, key)
        Reflect.deleteProperty(value, key)
      }
      continue
    }
    Object.defineProperty(user, key, { value: op.value, enumerable: true, configurable: true, writable: true })
    Object.defineProperty(value, key, { value: op.value, enumerable: true, configurable: true, writable: true })
  }
  descriptors[index] = { ...descriptor, value, user, revision: descriptor.revision + 1 }
}

function descriptor(ns: string, schema: z, value: Record<string, unknown>, user: Record<string, unknown> = {}): SettingsDescriptorView {
  return {
    ns,
    schema: envelope(schema),
    value,
    user,
    revision: 1,
    autoGenerate: true,
  }
}

// Descriptor fixtures model the REAL wire shape: `describe()` sends
// `volatileForm(schema).toJSON()`, whose `meta.volatile` markers were already
// stripped by the Host. A fixture carrying markers would let a marker-based
// projection pass here while showing nothing in a live session.
const SHELL_SCHEMA = z.object({
  timeoutMs: z.number().min(1).description('Foreground command timeout'),
  maxOutputBytes: z.number().min(1),
})

const SUBAGENT_SCHEMA = z.object({
  maxDepth: z.number().min(0),
  maxActiveSubagents: z.number().min(1),
})

const SECRET_SCHEMA = z.object({
  apiKey: z.string().role('secret'),
  model: z.string(),
})

const SIGNIN_SCHEMA = z.object({
  method: z.union(['browser', 'code']),
  enabled: z.boolean(),
})

interface MountOptions extends TuiHarnessOptions {
  settings?: FakeSettings | undefined
}

/** Mount the TUI with the given settings service (absent exercises the notice path). */
async function setup(options: MountOptions = {}) {
  const terminal = new FakeTerminal()
  const exit = vi.fn()
  const settings = options.settings
  const { settings: _ignored, ...harnessOptions } = options
  const result = await createTuiTestHarness(terminal, exit, {
    ...harnessOptions,
    async configureContext(ctx) {
      await options.configureContext?.(ctx)
      if (settings !== undefined) provideSettings(ctx, settings)
    },
  })
  await tick()
  return { ...result, settings }
}

/** Provide the fake service under the name the controller reads. */
function provideSettings(ctx: Context, service: FakeSettings): void {
  ctx.provide('settings', service as never)
}

/** Let queued microtasks and command promises settle. */
async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 25))
}

/** Run one slash command through the editor. */
async function run(result: Awaited<ReturnType<typeof setup>>, line: string): Promise<void> {
  result.terminal.send(line)
  result.terminal.send('\r')
  await tick()
}

describe('/settings command', () => {
  const disposers: (() => Promise<void>)[] = []
  // Display names follow the process locale; pin it so assertions do not drift
  // with the machine running the suite.
  const previousLanguage = process.env.DSH_TUI_LANG
  beforeEach(() => { process.env.DSH_TUI_LANG = 'en' })
  afterEach(async () => {
    for (const dispose of disposers.splice(0)) await dispose()
    if (previousLanguage === undefined) delete process.env.DSH_TUI_LANG
    else process.env.DSH_TUI_LANG = previousLanguage
  })

  async function mount(options: MountOptions = {}) {
    const result = await setup(options)
    disposers.push(() => disposeTuiTestHarness(result))
    return result
  }

  it('reports the missing service instead of opening a panel', async () => {
    const result = await mount()
    await run(result, '/settings')
    expect(result.terminal.output).toContain('Settings are unavailable')
    expect(result.terminal.output).not.toContain('╭ Settings')
  })

  it('lists configurable entries by display name and the session-local group', async () => {
    const settings = fakeSettings([
      descriptor('pwsh-sandbox', SHELL_SCHEMA, { timeoutMs: 120_000, maxOutputBytes: 64_000 }, { timeoutMs: 120_000 }),
      descriptor('subagent', SUBAGENT_SCHEMA, { maxDepth: 1, maxActiveSubagents: 8 }),
    ])
    const result = await mount({ settings })
    await run(result, '/settings')
    expect(result.terminal.output).toContain('╭ Settings')
    // The strip and rows carry friendly names; the entry id stays reachable on
    // its own footer line so the row is still findable in the profile document.
    expect(result.terminal.output).toContain('PowerShell sandbox')
    expect(result.terminal.output).toContain('Subagent')
    expect(result.terminal.output).toContain('Terminal (this session)')
    expect(result.terminal.output).toContain('Timeout (ms)')
    expect(result.terminal.output).toContain('120000')
    expect(result.terminal.output).toContain('override')
    expect(result.terminal.output).toContain('entry: pwsh-sandbox')
    expect(result.terminal.output).toContain('config: /home/user/.dsh/profiles/tui/cordis.patch.yml')
  })

  it('falls back to a prettified id for an entry with no curated name', async () => {
    const settings = fakeSettings([descriptor('my-custom-plugin', SHELL_SCHEMA, { timeoutMs: 1 })])
    const result = await mount({ settings })
    await run(result, '/settings')
    expect(result.terminal.output).toContain('My custom plugin')
    expect(result.terminal.output).toContain('entry: my-custom-plugin')
  })

  it('writes a numeric field with the revision it read, then refreshes', async () => {
    const settings = fakeSettings([descriptor('pwsh-sandbox', SHELL_SCHEMA, { timeoutMs: 120_000, maxOutputBytes: 64_000 })])
    const result = await mount({ settings })
    await run(result, '/settings')
    // Enter opens the editor seeded with the current value. Typing a printable
    // character replaces the whole seed, so no clearing keystroke is needed.
    result.terminal.send('\r')
    await tick()
    result.terminal.send('90000')
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(settings.writes).toHaveLength(1) })
    expect(settings.writes[0]).toEqual({
      ns: 'pwsh-sandbox',
      ops: [{ op: 'set', path: ['timeoutMs'], value: 90000 }],
      revision: 1,
    })
    // The panel was refreshed from the new descriptor value.
    await vi.waitFor(() => { expect(result.terminal.output).toContain('90000') })
    expect(result.terminal.output).toContain('Timeout (ms) of PowerShell sandbox updated.')
    // The write reached the shape the Host validates: one op, one path.
    expect(settings.descriptors[0]?.revision).toBe(2)
  })

  it('edits a seeded value in place when the edit starts with a cursor key', async () => {
    const settings = fakeSettings([descriptor('pwsh-sandbox', SHELL_SCHEMA, { timeoutMs: 120_000 })])
    const result = await mount({ settings })
    await run(result, '/settings')
    result.terminal.send('\r')
    await tick()
    // Backspace edits the seed instead of replacing it: `120000` -> `12000`.
    for (let index = 0; index < 1; index += 1) result.terminal.send('\x7f')
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(settings.writes).toHaveLength(1) })
    expect(settings.writes[0]?.ops).toEqual([{ op: 'set', path: ['timeoutMs'], value: 12_000 }])
  })

  it('flips a boolean and cycles an enum without an editor', async () => {
    const settings = fakeSettings([descriptor('ui-signin', SIGNIN_SCHEMA, { method: 'browser', enabled: false })])
    const result = await mount({ settings })
    await run(result, '/settings')
    // `method` is the first field: Enter cycles browser -> code.
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(settings.writes).toHaveLength(1) })
    expect(settings.writes[0]?.ops).toEqual([{ op: 'set', path: ['method'], value: 'code' }])
    // Down to `enabled`, Enter flips it to true.
    result.terminal.send('\x1b[B')
    await tick()
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(settings.writes).toHaveLength(2) })
    expect(settings.writes[1]?.ops).toEqual([{ op: 'set', path: ['enabled'], value: true }])
  })

  it('resets an overridden field to its inherited value', async () => {
    const settings = fakeSettings([
      descriptor('pwsh-sandbox', SHELL_SCHEMA, { timeoutMs: 90_000, maxOutputBytes: 64_000 }, { timeoutMs: 90_000 }),
    ])
    const result = await mount({ settings })
    await run(result, '/settings')
    result.terminal.send('r')
    await vi.waitFor(() => { expect(settings.writes).toHaveLength(1) })
    expect(settings.writes[0]?.ops).toEqual([{ op: 'unset', path: ['timeoutMs'] }])
  })

  it('refuses to reset a field the user layer does not carry', async () => {
    const settings = fakeSettings([descriptor('pwsh-sandbox', SHELL_SCHEMA, { timeoutMs: 120_000 })])
    const result = await mount({ settings })
    await run(result, '/settings')
    result.terminal.send('r')
    await tick()
    expect(settings.writes).toEqual([])
    expect(result.terminal.output).toContain('This field is not overridden.')
  })

  it('renders a secret as set/unset and never echoes a value', async () => {
    const settings = fakeSettings([{
      ...descriptor('web-search-deepseek', SECRET_SCHEMA, { model: 'deepseek-chat' }),
      secrets: [{ path: ['apiKey'], set: true }],
    }])
    const result = await mount({ settings })
    await run(result, '/settings')
    expect(result.terminal.output).toContain('API key')
    expect(result.terminal.output).toContain('(set)')
    expect(result.terminal.output).not.toContain('sk-')

    // Enter opens the secret editor empty; submitting a value writes it.
    result.terminal.send('\r')
    await tick()
    result.terminal.send('sk-test-key')
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(settings.writes).toHaveLength(1) })
    expect(settings.writes[0]?.ops).toEqual([{ op: 'set', path: ['apiKey'], value: 'sk-test-key' }])
  })

  it('reports an entry argument it does not know', async () => {
    const settings = fakeSettings([descriptor('pwsh-sandbox', SHELL_SCHEMA, { timeoutMs: 120_000 })])
    const result = await mount({ settings })
    await run(result, '/settings nope')
    expect(result.terminal.output).toContain('Unknown settings entry "nope"')
    expect(result.terminal.output).toContain('PowerShell sandbox (pwsh-sandbox)')
    expect(result.terminal.output).not.toContain('╭ Settings')
  })

  it('opens directly on an explicit entry id or display name', async () => {
    const settings = fakeSettings([
      descriptor('pwsh-sandbox', SHELL_SCHEMA, { timeoutMs: 120_000 }),
      descriptor('subagent', SUBAGENT_SCHEMA, { maxDepth: 1 }),
    ])
    const byId = await mount({ settings })
    await run(byId, '/settings subagent')
    expect(byId.terminal.output).toContain('╭ Settings')
    expect(byId.terminal.output).toContain('Max delegation depth')
    expect(byId.terminal.output).not.toContain('Timeout (ms)')

    const byName = await mount({ settings })
    await run(byName, '/settings subagent')
    expect(byName.terminal.output).toContain('entry: subagent')
  })

  it('reports a write the Host refused, keeping the panel open', async () => {
    const settings = fakeSettings([
      descriptor('pwsh-sandbox', SHELL_SCHEMA, { timeoutMs: 90_000 }, { timeoutMs: 90_000 }),
    ])
    settings.failWith = Object.assign(new Error('changed since it was read'), { code: 'SETTINGS_CONFLICT' })
    const result = await mount({ settings })
    await run(result, '/settings')
    result.terminal.send('r')
    await vi.waitFor(() => { expect(settings.writes).toHaveLength(1) })
    await vi.waitFor(() => { expect(result.terminal.output).toContain('Configuration changed elsewhere') })
    expect(result.terminal.output).toContain('╭ Settings')
  })

  it('reports an unreadable configuration instead of throwing', async () => {
    const settings = fakeSettings([])
    settings.describe = () => { throw new Error('configuration document is corrupt') }
    const result = await mount({ settings })
    await run(result, '/settings')
    expect(result.terminal.output).toContain('Could not read settings: configuration document is corrupt')
    expect(result.terminal.output).not.toContain('╭ Settings')
  })

  it('applies the session-local group without writing the profile', async () => {
    const settings = fakeSettings([descriptor('pwsh-sandbox', SHELL_SCHEMA, { timeoutMs: 120_000 })])
    const result = await mount({ settings })
    await run(result, '/settings')
    // Move to the last section: the session-local group.
    result.terminal.send('\x1b[C')
    await tick()
    expect(result.terminal.output).toContain('Show reasoning')
    result.terminal.send('\r')
    await tick()
    // The panel repaints the flipped value; the transcript notice it also emits
    // sits behind the dialog, so the row is the observable result here.
    expect(result.terminal.output).toContain('Show reasoning    off')
    expect(result.agent.status).toBe('idle')
    expect(settings.writes).toEqual([])
  })

  it('lists the command in /help', async () => {
    const settings = fakeSettings([descriptor('pwsh-sandbox', SHELL_SCHEMA, {})])
    const result = await mount({ settings })
    await run(result, '/help')
    expect(result.terminal.output).toContain('/settings [namespace] — Show or edit this profile\'s live plugin settings')
  })

  it('offers the interface language as a live field of the TUI entry', async () => {
    // `locale` is the `tui` entry's one volatile field, so `/settings` lists it
    // and Enter cycles auto -> en -> zh -> auto, writing the choice back to the
    // profile patch the same way every other live field is written.
    //
    // The fixture is the Host's form projection: `describe()` sends
    // `volatileForm(...).toJSON()`, whose `meta.volatile` markers were already
    // stripped, so the schema here is the plain live subtree.
    const TUI_SCHEMA = z.object({ locale: z.union(['auto', 'en', 'zh']).default('auto') })
    const settings = fakeSettings([descriptor('tui', TUI_SCHEMA, { locale: 'auto' })])
    const result = await mount({ settings })
    await run(result, '/settings tui')
    // The row is named from the curated label table, not the raw config key.
    expect(result.terminal.output).toContain('Locale')
    expect(result.terminal.output).toContain('auto')

    result.terminal.send('\r')
    await tick()
    expect(settings.writes).toHaveLength(1)
    expect(settings.writes[0]).toMatchObject({
      ns: 'tui',
      ops: [{ op: 'set', path: ['locale'], value: 'en' }],
    })
  })
})
