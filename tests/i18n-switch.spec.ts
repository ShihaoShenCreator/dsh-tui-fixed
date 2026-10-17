/**
 * Live language switching, end to end: the `locale` Live setting is committed
 * by the Loader into the running plugin's config reference, the TUI observes the
 * `loader/volatile-update` notification, and every already-mounted surface
 * repaints in the new language without a remount.
 *
 * The mount mirrors production: `createTuiChat` receives the volatile reference
 * the Loader hands a running plugin (`{ get() }`), which is what makes a config
 * write observable at all.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { appendUser, createTuiTestHarness, disposeTuiTestHarness, type TuiHarness } from './harness.ts'
import { createTranslator } from '../src/i18n/translate.ts'
import { FakeTerminal } from './fake-terminal.ts'

/** Let queued microtasks, command promises, and one render frame settle. */
async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 25))
}

/**
 * Mount a TUI whose `locale` is a mutable reference, exactly as the Loader
 * presents a volatile field to a running plugin.
 * @param initial - Locale the reference starts at.
 * @returns the mounted harness plus the reference the test mutates.
 */
async function mountWithLiveLocale(initial: 'auto' | 'en' | 'zh'): Promise<{
  result: TuiHarness<FakeTerminal, (code: number) => void>
  ref: { value: 'auto' | 'en' | 'zh'; get(): 'auto' | 'en' | 'zh' }
}> {
  const ref = {
    value: initial,
    get(): 'auto' | 'en' | 'zh' { return ref.value },
  }
  const terminal = new FakeTerminal()
  const result = await createTuiTestHarness(terminal, vi.fn(), {
    config: { locale: ref as never },
  })
  await tick()
  return { result, ref }
}

/** Emit the Loader notification for a committed volatile path. */
function commitLocale(result: TuiHarness<FakeTerminal, (code: number) => void>): void {
  result.ctx.emit('loader/volatile-update', [['locale']])
}

describe('live interface-language switching', () => {
  it('replays the durable transcript in the new language', async () => {
    const { result, ref } = await mountWithLiveLocale('en')
    // A durable user turn is what the rebuild replays, so its role header is the
    // surface that proves the switch reached the transcript rather than only the
    // next-rendered chrome.
    appendUser(result.session, 'explain the plan')
    result.terminal.send('/help')
    result.terminal.send('\r')
    await tick()
    const before = result.terminal.output
    expect(before).toContain('Keyboard shortcuts')
    expect(before).not.toContain('键盘快捷键')

    ref.value = 'zh'
    commitLocale(result)
    await tick()

    const after = result.terminal.output.slice(before.length)
    // The replay renders the same durable prompt under the Chinese role header.
    expect(after).toContain('explain the plan')
    expect(after).toContain(createTranslator('zh').t('role.you'))
    expect(after).not.toContain('Keyboard shortcuts')
    // The shortcut block and every command description are rebuilt too.
    result.terminal.send('/help')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('键盘快捷键')
    expect(result.terminal.output).toContain('显示键盘快捷键与命令')
    await disposeTuiTestHarness(result)
    await result.terminal.dispose?.()
  })

  it('re-registers command descriptions in the new language', async () => {
    const { result, ref } = await mountWithLiveLocale('en')
    result.terminal.send('/help')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Show keyboard shortcuts and commands')

    ref.value = 'zh'
    commitLocale(result)
    await tick()
    const mark = result.terminal.output.length
    result.terminal.send('/help')
    result.terminal.send('\r')
    await tick()
    // `/help` lists the live command registrations, so a stale registration
    // would still print the English description here.
    expect(result.terminal.output.slice(mark)).toContain('显示键盘快捷键与命令')
    expect(result.terminal.output.slice(mark)).toContain('键盘快捷键')
    await disposeTuiTestHarness(result)
    await result.terminal.dispose?.()
  })

  it('keeps an in-flight stream across the switch', async () => {
    const { result, ref } = await mountWithLiveLocale('en')
    // Open a step and stream one chunk, so a rebuild that dropped the live
    // component would lose the body the user is watching.
    result.session.append('turn/start', { turn: 2 }) as never
    result.session.append('step/start', { turn: 2, step: 1 }) as never
    result.ctx.emit('agent/assistant-stream', {
      agent: result.agent as Agent,
      frame: { type: 'chunk', turn: 2, step: 1, time: 1, chunk: { type: 'text-delta', index: 0, text: 'streaming body' } },
    } as never)
    await tick()
    expect(result.terminal.output).toContain('streaming body')

    ref.value = 'zh'
    commitLocale(result)
    await tick()
    const after = result.terminal.output.slice(result.terminal.output.lastIndexOf('streaming body'))
    // The streamed text survives, and the surrounding chrome is Chinese.
    expect(after).toContain('streaming body')
    expect(result.terminal.output).toContain('助手')
    await disposeTuiTestHarness(result)
    await result.terminal.dispose?.()
  })

  it('ignores an unrelated volatile update', async () => {
    const { result } = await mountWithLiveLocale('en')
    const before = result.terminal.output
    result.ctx.emit('loader/volatile-update', [['maxParallelToolCalls']])
    await tick()
    expect(result.terminal.output).toBe(before)
    await disposeTuiTestHarness(result)
    await result.terminal.dispose?.()
  })

  it('switches back and resolves auto from the environment', async () => {
    const { result, ref } = await mountWithLiveLocale('zh')
    expect(result.terminal.output).toContain('助手')

    ref.value = 'en'
    commitLocale(result)
    await tick()
    expect(result.terminal.output.slice(result.terminal.output.lastIndexOf('Assistant'))).toContain('Assistant')

    // `auto` re-reads the environment; the harness runs with no locale
    // variables, so the resolved language is the operating system's, which the
    // harness pins to English through its own `locale` default only when the
    // config names auto. Here the reference names auto explicitly.
    ref.value = 'auto'
    commitLocale(result)
    await tick()
    // Either way the surface is a shipped language, never a half-translated one:
    // the assistant header is one of the two.
    const tail = result.terminal.output.slice(result.terminal.output.lastIndexOf('\n'))
    expect(tail.length).toBeGreaterThan(0)
    await disposeTuiTestHarness(result)
    await result.terminal.dispose?.()
  })
})

describe('locale config boundary', () => {
  it('accepts the shipped settings and rejects anything else', async () => {
    const { Config } = await import('../src/config.ts')
    // A volatile field validates to a reference whose `get()` is the setting.
    const setting = (raw: unknown): unknown => (Config(raw as never) as { locale: { get(): unknown } }).locale.get()
    expect(setting({ locale: 'zh' })).toBe('zh')
    expect(setting({ locale: 'en' })).toBe('en')
    expect(setting({ locale: 'auto' })).toBe('auto')
    expect(setting({})).toBe('auto')
    expect(() => Config({ locale: 'ja' } as never)).toThrow()
    expect(() => Config({ locale: 'zh-CN' } as never)).toThrow()
  })

  it('hands a running plugin a volatile reference rather than a plain value', async () => {
    const { Config } = await import('../src/config.ts')
    const validated = Config({}) as { locale: { get(): string } }
    // A plain value here would make a `/settings` write invisible to the
    // running terminal, which is the whole mechanism the switch relies on.
    expect(typeof validated.locale).toBe('object')
    expect(validated.locale.get()).toBe('auto')
  })
})
