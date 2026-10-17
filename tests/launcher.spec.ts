/** Launcher facts: invocation resolution, the in-place resume host, and the exit line. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createResumeHost,
  formatGoodbyeMessage,
  launcherEnvironment,
  resolveLauncherInvocation,
} from '../src/launcher.ts'

const dirs: string[] = []

/** Create a scratch package whose manifest is `manifest`, returning its package.json path. */
function scratchPackage(manifest: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-launcher-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'lib'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  return join(dir, 'package.json')
}

/** Create a scratch launcher entry module and return its absolute path. */
function scratchEntry(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-entry-'))
  dirs.push(dir)
  const entry = join(dir, 'bin.js')
  writeFileSync(entry, 'export {}\n')
  return entry
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('launcher environment', () => {
  it('reads the profile name and install anchor from a provided profileContext', () => {
    const anchor = scratchPackage({ name: '@deepseek-ai/dsh' })
    expect(launcherEnvironment({
      get: () => ({ name: 'tui', installAnchor: anchor, dir: '/profiles/tui' }),
    })).toEqual({ profile: 'tui', installAnchor: anchor })
  })

  it('reports no environment without a profileContext or a name', () => {
    expect(launcherEnvironment({ get: () => undefined })).toBeUndefined()
    expect(launcherEnvironment({ get: () => ({ installAnchor: '/x' }) })).toBeUndefined()
    expect(launcherEnvironment({ get: () => ({ name: 'tui' }) }))
      .toEqual({ profile: 'tui', installAnchor: undefined })
  })

  it('reads the context non-strictly so a launcher-provided value is visible before activation', () => {
    const get = vi.fn(() => ({ name: 'tui' }))
    launcherEnvironment({ get })
    // The launcher provides `profileContext` on the host context, whose fiber is
    // active before any tree entry mounts; the non-strict read also survives a
    // service read whose providing fiber is being replaced.
    expect(get).toHaveBeenCalledWith('profileContext', false)
  })
})

describe('launcher invocation', () => {
  it('replays the launcher entry this process is running', () => {
    // The same dsh package can be hosted by different carriers (packaged
    // Desktop, a source launch, a plain Node install), so the entry actually
    // running wins over the manifest bin.
    const entry = scratchEntry()
    expect(resolveLauncherInvocation(undefined, {
      execPath: '/node', entry, execArgv: ['--expose-internals'],
    })).toEqual({ command: '/node', args: ['--expose-internals', entry] })
  })

  it('falls back to the manifest dsh bin when the entry cannot be replayed', () => {
    const anchor = scratchPackage({ name: '@deepseek-ai/dsh', bin: { dsh: 'lib/bin.js' } })
    expect(resolveLauncherInvocation(anchor, { execPath: '/usr/bin/node', entry: undefined, execArgv: [] }))
      .toEqual({ command: '/usr/bin/node', args: [join(dirname(anchor), 'lib', 'bin.js')] })
    const stringBin = scratchPackage({ name: '@deepseek-ai/dsh', bin: 'cli.js' })
    expect(resolveLauncherInvocation(stringBin, { execPath: '/node', entry: '', execArgv: [] }))
      .toEqual({ command: '/node', args: [join(dirname(stringBin), 'cli.js')] })
  })

  it('rejects a non-module or missing entry and an unusable anchor', () => {
    expect(resolveLauncherInvocation(undefined, { execPath: '/node', entry: '/node', execArgv: [] }))
      .toBeUndefined()
    expect(resolveLauncherInvocation(undefined, {
      execPath: '/node', entry: join(tmpdir(), 'dsh-tui-entry-missing.js'), execArgv: [],
    })).toBeUndefined()
    expect(resolveLauncherInvocation(undefined, { execPath: '/node', entry: undefined, execArgv: [] }))
      .toBeUndefined()
    expect(resolveLauncherInvocation(scratchPackage({ name: 'x' }), {
      execPath: '/node', entry: undefined, execArgv: [],
    })).toBeUndefined()
    expect(resolveLauncherInvocation(join(tmpdir(), 'dsh-tui-launcher-missing', 'package.json'), {
      execPath: '/node', entry: undefined, execArgv: [],
    })).toBeUndefined()
  })

  it('defaults every process fact to this process so production needs no arguments', () => {
    // `process.argv[1]` is the test runner's worker entry under Vitest, which is
    // a replayable module; the point is that the default path inspects the live
    // process rather than requiring callers to thread facts through.
    const invocation = resolveLauncherInvocation(undefined)
    expect(invocation?.command).toBe(process.execPath)
    expect(invocation?.args.at(-1)).toBe(process.argv[1])
  })
})

describe('resume host', () => {
  const invocation = { command: '/node', args: ['/dsh/lib/bin.js'] }

  it('re-execs the launcher into the session workspace and mirrors its exit status', async () => {
    const spawn = vi.fn(() => ({ status: 7 }))
    const exit = vi.fn()
    const host = createResumeHost({ invocation, profile: 'tui', spawn, exit })
    // A default boundary would end this process; the injectable exit proves the
    // handoff commits instead, and the rejection reports a launcher that
    // returned without replacing the process.
    await expect(host.handoff(SessionId('picked'), '/work/space')).rejects.toThrow('status 7')
    expect(spawn).toHaveBeenCalledWith(
      '/node',
      ['/dsh/lib/bin.js', '--profile', 'tui', '--resume', 'picked'],
      { cwd: '/work/space', stdio: 'inherit' },
    )
    expect(exit).toHaveBeenCalledWith(7)
  })

  it('reports a spawn failure without exiting', async () => {
    const exit = vi.fn()
    const host = createResumeHost({
      invocation,
      profile: 'tui',
      spawn: () => ({ error: new Error('ENOENT'), status: null }),
      exit,
    })
    await expect(host.handoff(SessionId('picked'), '/work/space'))
      .rejects.toThrow('cannot re-exec the dsh launcher: ENOENT')
    expect(exit).not.toHaveBeenCalled()
  })

  it('reports a throwing spawn and treats a null status as failure', async () => {
    const exit = vi.fn()
    const throwing = createResumeHost({
      invocation,
      profile: 'tui',
      spawn: () => { throw new Error('EPERM') },
      exit,
    })
    await expect(throwing.handoff(SessionId('picked'), '/cwd'))
      .rejects.toThrow('cannot re-exec the dsh launcher: EPERM')
    const nullStatus = createResumeHost({ invocation, profile: 'tui', spawn: () => ({ status: null }), exit })
    await expect(nullStatus.handoff(SessionId('picked'), '/cwd')).rejects.toThrow('status 1')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('spawns whatever entry it was resolved for, so a carrier that needs interpreter flags keeps them', async () => {
    // The packaged Desktop CLI is `DeepSeek Harness.exe --expose-internals
    // <cli.js>`; the handoff must reproduce that prefix, not a bare manifest bin.
    const spawn = vi.fn(() => ({ status: 0 }))
    createResumeHost({
      invocation: { command: '/harness', args: ['--expose-internals', '/asar/cli.js'] },
      profile: 'tui',
      spawn,
      exit: vi.fn(),
    }).handoff(SessionId('desktop'), '/workspace').catch(() => {})
    expect(spawn).toHaveBeenCalledWith(
      '/harness',
      ['--expose-internals', '/asar/cli.js', '--profile', 'tui', '--resume', 'desktop'],
      { cwd: '/workspace', stdio: 'inherit' },
    )
  })
})

describe('goodbye message', () => {
  it('names the profile and session id', () => {
    expect(formatGoodbyeMessage('tui', SessionId('main-session')))
      .toBe('To resume this session: dsh --profile tui --resume main-session')
  })
})
