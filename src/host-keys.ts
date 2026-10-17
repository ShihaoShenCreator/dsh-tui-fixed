/**
 * Context keys the terminal app's launcher-side facts travel on, plus the
 * Cordis declarations those services are read through.
 *
 * The provider that supplies them (`./startup`) and the TUI that consumes them
 * (`./index`) share this one module, so the two sides cannot drift apart. A key
 * is absent when the process was not booted by a `dsh` launcher — a test
 * harness, an embedding, or a host that cannot replace itself — and every
 * consumer must treat absent as "the capability is unavailable".
 * @module @shihaoshen/dsh-tui-fixed/host-keys
 */

import type { TuiResumeHost } from './runtime.ts'

/**
 * Context key a launcher sets before any Loader entry mounts
 * (`ctx.provide(TUI_RESUME_HOST_KEY, host)`) to give the TUI an in-place resume
 * host. The TUI's `/resume` handoff calls `host.handoff(sessionId, cwd)` after
 * releasing the terminal; absent leaves a session selectable but not resumable
 * in place.
 */
export const TUI_RESUME_HOST_KEY = 'tuiResumeHost'

/**
 * Context key a launcher sets before any Loader entry mounts
 * (`ctx.provide(TUI_GOODBYE_MESSAGE_KEY, line)`) to supply the line the TUI
 * prints once the terminal is released on exit — for the shipped CLI, the
 * command that resumes this session. The launcher owns the wording because only
 * it knows how it was invoked; the TUI escapes terminal controls before
 * rendering. Absent prints nothing.
 */
export const TUI_GOODBYE_MESSAGE_KEY = 'tuiGoodbyeMessage'

/**
 * Context key a launcher sets before any Loader entry mounts
 * (`ctx.provide(INITIAL_SKILL_KEY, name)`) to seed a fresh session's first user
 * turn with `/skill:<name>` — the guided-session entry. The launcher sets it
 * only when minting a fresh session, so it never re-fires on a resumed one.
 * Absent leaves the first turn to the user.
 */
export const INITIAL_SKILL_KEY = 'tuiInitialSkill'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional process host that can replace this TUI with a resumed session. */
    tuiResumeHost: TuiResumeHost
    /** Line the launcher wants printed on exit; absent prints nothing. */
    tuiGoodbyeMessage: string | undefined
    /** Skill the launcher wants auto-invoked as the fresh session's first turn; absent leaves it to the user. */
    tuiInitialSkill: string | undefined
  }
}
