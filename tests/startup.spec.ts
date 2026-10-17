/** TUI command provider over a real Loader tree and lazy consumer config. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, TUI_STARTUP_SERVICE, type TuiStartupValues } from '../src/startup.ts'
import { TUI_GOODBYE_MESSAGE_KEY, TUI_RESUME_HOST_KEY } from '../src/host-keys.ts'

/** Effects observed from one provider boot. */
interface Observed {
  exits: number[]
  output: string
  readerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

/* Restore process output even when an assertion fails. */
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/**
 * Mount the provider beside a consumer that reads `ctx.tuiStartup` lazily.
 * @param args - inner arguments handed over by the launcher.
 * @param options - optional launcher state to provide before the tree mounts.
 * @returns the provider service, the launcher host keys, and observable
 *   consumer/process effects.
 */
async function bootProvider(args: string[], options: {
  /** `profileContext` a dsh launcher provides before any entry mounts. */
  profileContext?: unknown
  /** A host key an embedding launcher provided first; the provider must not replace it. */
  preProvided?: Record<string, unknown>
} = {}): Promise<{
  values: TuiStartupValues | undefined
  host: { resumeHost: unknown; goodbyeMessage: unknown }
  observed: Observed
}> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-startup-'))
  const observed: Observed = { exits: [], output: '' }
  writeFileSync(join(dir, 'reader.mjs'), `
export function apply(_ctx, config) { globalThis.__tuiStartupObserved.readerConfig = config }
`)
  writeFileSync(join(dir, 'provider.mjs'), `
export const name = 'tui-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__tuiStartupApply(ctx)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: reader',
    `  name: ${pathToFileURL(join(dir, 'reader.mjs')).href}`,
    `  inject: [${TUI_STARTUP_SERVICE}]`,
    '  config:',
    '    sessionId: !!js ctx.tuiStartup.sessionId',
    '    resumeSessionId: !!js ctx.tuiStartup.resumeSessionId',
    '- id: provider',
    `  name: ${pathToFileURL(join(dir, 'provider.mjs')).href}`,
    '',
  ].join('\n'))
  const output = { write: (chunk: string) => { observed.output += chunk; return true } }
  internals.stdout = output
  internals.stderr = output
  const globals = globalThis as unknown as {
    __tuiStartupApply: typeof apply
    __tuiStartupObserved: Observed
  }
  globals.__tuiStartupApply = apply
  globals.__tuiStartupObserved = observed

  const ctx = new Context()
  disposers.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  // The launcher provides these on its host context before any tree entry
  // mounts, so they outlive the provider row and are visible to every row.
  if (options.profileContext !== undefined) ctx.provide('profileContext', options.profileContext)
  for (const [key, value] of Object.entries(options.preProvided ?? {})) ctx.provide(key, value)
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  return {
    values: ctx.get(TUI_STARTUP_SERVICE) as TuiStartupValues | undefined,
    host: {
      resumeHost: ctx.get(TUI_RESUME_HOST_KEY),
      goodbyeMessage: ctx.get(TUI_GOODBYE_MESSAGE_KEY),
    },
    observed,
  }
}

describe('TUI command-line provider', () => {
  it('publishes a resumed session and releases direct service expressions', async () => {
    const { values, observed } = await bootProvider(['--resume', 'persisted-session'])
    expect(values).toEqual({ resumeSessionId: 'persisted-session' })
    expect(observed.readerConfig).toEqual({
      sessionId: undefined,
      resumeSessionId: 'persisted-session',
    })
    expect(observed.exits).toEqual([])
  })

  it('mints a fresh default identity and accepts an explicitly named fresh session', async () => {
    const firstDefault = await bootProvider([])
    const firstSessionId = firstDefault.values?.sessionId
    expect(firstSessionId).toEqual(expect.any(String))
    expect(firstDefault.observed.readerConfig).toEqual({
      sessionId: firstSessionId,
      resumeSessionId: undefined,
    })

    const secondDefault = await bootProvider([])
    expect(secondDefault.values?.sessionId).not.toBe(firstSessionId)

    const namedRun = await bootProvider(['--session', 'review'])
    expect(namedRun.values).toEqual({ sessionId: 'review' })
    expect(namedRun.observed.readerConfig).toEqual({ sessionId: 'review', resumeSessionId: undefined })
  })

  it('prints app help and leaves session-bound rows pending', async () => {
    const { values, observed } = await bootProvider(['--help'])
    expect(observed.output).toContain('dsh --profile tui')
    expect(observed.output).toContain('--resume <session>')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })

  it('rejects conflicting session selectors before the consumer activates', async () => {
    const { values, observed } = await bootProvider(['--resume', 'old', '--session', 'new'])
    expect(observed.output).toContain('pass only one')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('rejects an empty session identity before the consumer activates', async () => {
    const { values, observed } = await bootProvider(['--session', '   '])
    expect(observed.output).toContain('session id must not be empty')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })
})

describe('launcher host facts', () => {
  /** Scratch install directories, removed with the provider's own fixtures. */
  const installs: string[] = []

  /** A manifest whose `dsh` bin is the fallback launcher entry. */
  function scratchInstall(): string {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-install-'))
    installs.push(dir)
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'bin.js'), 'export {}\n')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', bin: { dsh: 'lib/bin.js' } }))
    return join(dir, 'package.json')
  }

  afterEach(() => {
    for (const dir of installs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('publishes an in-place resume host and the exit line from profileContext', async () => {
    const { values, host } = await bootProvider(['--resume', 'persisted-session'], {
      profileContext: { name: 'tui', installAnchor: scratchInstall() },
    })
    expect(values).toEqual({ resumeSessionId: 'persisted-session' })
    expect(host.resumeHost).toMatchObject({ handoff: expect.any(Function) })
    expect(host.goodbyeMessage)
      .toBe('To resume this session: dsh --profile tui --resume persisted-session')
  })

  it('names the freshly minted session in the exit line', async () => {
    const { values, host } = await bootProvider([], {
      profileContext: { name: 'tui', installAnchor: scratchInstall() },
    })
    // A bare launch still knows how to come back to the session it created.
    expect(host.goodbyeMessage)
      .toBe(`To resume this session: dsh --profile tui --resume ${values?.sessionId}`)
  })

  it('publishes no host facts when the app was not launched by dsh', async () => {
    const { values, host } = await bootProvider(['--session', 'review'])
    // This is the "resumable but cannot hand off in place" case: the picker
    // still works, selection reports the missing capability instead of failing.
    expect(values).toEqual({ sessionId: 'review' })
    expect(host.resumeHost).toBeUndefined()
    expect(host.goodbyeMessage).toBeUndefined()
  })

  it('leaves host keys an embedding launcher already provided', async () => {
    const embeddingHost = { handoff: () => Promise.reject(new Error('embedding wins')) }
    const { host } = await bootProvider(['--session', 'review'], {
      profileContext: { name: 'tui', installAnchor: scratchInstall() },
      preProvided: { [TUI_RESUME_HOST_KEY]: embeddingHost, [TUI_GOODBYE_MESSAGE_KEY]: 'embedding line' },
    })
    // `ctx.provide` rejects a second registration of one service, so the
    // embedding launcher's own host must win for its process.
    expect(host.resumeHost).toBe(embeddingHost)
    expect(host.goodbyeMessage).toBe('embedding line')
  })

  it('publishes a host from the running launcher entry even when the install anchor is unusable', async () => {
    const { host } = await bootProvider(['--session', 'review'], {
      // The entry this process is actually running is authoritative: an
      // unreadable anchor cannot disable resuming inside a real dsh process.
      profileContext: { name: 'tui', installAnchor: join(tmpdir(), 'dsh-tui-install-missing', 'package.json') },
    })
    expect(host.resumeHost).toMatchObject({ handoff: expect.any(Function) })
    expect(host.goodbyeMessage).toBe('To resume this session: dsh --profile tui --resume review')
  })
})
