/**
 * The terminal app's ordinary command provider: it owns the
 * `dsh --profile tui` flag family
 * (`--resume`, `--session`) and its `--help` text, and provides the session
 * identity this process drives as {@link TUI_STARTUP_SERVICE}.
 *
 * It also publishes the launcher-side host facts the terminal reads: the
 * in-place resume host (see {@link TUI_RESUME_HOST_KEY}) and the exit line
 * naming how to resume the session (see {@link TUI_GOODBYE_MESSAGE_KEY}). Both
 * are derived from the profile this process booted — `profileContext`,
 * provided by the dsh launcher — and are simply absent when the app is mounted
 * without one, which is the case the terminal reports as an unavailable
 * handoff. A key an embedding launcher already provided is left alone, because
 * that launcher's own host owns the process it spawned.
 *
 * The agent-loop and TUI rows inject this service before evaluating their
 * own config expressions, so the terminal can never open on the wrong session
 * and `--help` prints without starting an agent.
 * @module @shihaoshen/dsh-tui-fixed/startup
 */

import { randomUUID } from 'node:crypto'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  TUI_GOODBYE_MESSAGE_KEY,
  TUI_RESUME_HOST_KEY,
} from './host-keys.ts'
import {
  createResumeHost,
  formatGoodbyeMessage,
  launcherEnvironment,
  resolveLauncherInvocation,
} from './launcher.ts'
import { detectLocale } from './i18n/locale.ts'
import { createTranslator } from './i18n/translate.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the session identity can be resolved. */
export const inject = ['cmdlineArgs']

/** The service this row provides and the session-bound rows read. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/**
 * What the session-bound rows read from {@link TUI_STARTUP_SERVICE}. Exactly
 * one of the two is present: the provider rejects both selectors together,
 * and resuming replaces the fresh identity rather than adding to it.
 */
export interface TuiStartupValues {
  /** The fresh session to create; absent when resuming. */
  sessionId?: SessionId
  /** The persisted session to continue; absent unless `--resume` named one. */
  resumeSessionId?: SessionId
}

/**
 * This app's command: its flags, its description, and its help text.
 *
 * The wording follows the process environment rather than the `tui` row's
 * `locale`: this provider runs before any agent exists, and `--help` must print
 * without one. A deployment that pins a language in configuration therefore
 * gets localized help only through its environment — documented in the README.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand(): Command {
  const { t } = createTranslator(detectLocale())
  return new Command()
    .name('dsh --profile tui')
    .description(t('startup.description'))
    .helpOption('-h, --help', t('startup.helpOption'))
    .option('-r, --resume <session>', t('startup.resumeOption'))
    .option('-s, --session <id>', t('startup.sessionOption'))
    .addHelpText('after', t('startup.examples'))
}

/** The tui flag family, as commander parsed it. */
interface TuiOptions {
  resume?: string
  session?: string
}

/**
 * Resolve the session identity this invocation asked for.
 * @param program - the parsed tui command.
 * @returns the session-bound rows' service value.
 */
function resolveTuiStartup(program: Command): TuiStartupValues {
  const { t } = createTranslator(detectLocale())
  const options = program.opts<TuiOptions>()
  if (options.resume !== undefined && options.session !== undefined) {
    program.error(t('startup.error.bothSelectors'))
  }
  const selected = options.resume ?? options.session
  if (selected?.trim() === '') program.error(t('startup.error.emptySessionId'))
  const sessionId = SessionId(selected ?? `session-${randomUUID()}`)
  return options.resume === undefined ? { sessionId } : { resumeSessionId: sessionId }
}

/**
 * Publish the launcher-side host facts for the resolved session. Each is
 * omitted when the profile cannot supply it: no `profileContext` means the app
 * was not launched by dsh, so there is no launcher to hand off to and no
 * invocation to name in the exit line.
 * @param ctx - plugin context carrying optional launcher state.
 * @param values - the resolved session identity.
 */
function provideLauncherHost(ctx: Context, values: TuiStartupValues): void {
  const absent = (name: string): boolean => ctx.get(name, false) === undefined
  const environment = launcherEnvironment(ctx)
  if (environment === undefined) return
  const invocation = resolveLauncherInvocation(environment.installAnchor)
  if (invocation !== undefined && absent(TUI_RESUME_HOST_KEY)) {
    ctx.provide(TUI_RESUME_HOST_KEY, createResumeHost({
      invocation,
      profile: environment.profile,
    }))
  }
  const sessionId = values.sessionId ?? values.resumeSessionId
  /* v8 ignore next -- exactly one identity is present, as resolveTuiStartup guarantees. */
  if (sessionId !== undefined && absent(TUI_GOODBYE_MESSAGE_KEY)) {
    ctx.provide(TUI_GOODBYE_MESSAGE_KEY, formatGoodbyeMessage(
      environment.profile,
      sessionId,
      createTranslator(detectLocale()).t,
    ))
  }
}

/**
 * Resolve the session identity the rest of this app's rows read. The
 * command's action publishes the identity; conflicting or empty selectors are
 * usage errors, so on rejection (and on `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const values = resolveTuiStartup(program)
    provideLauncherHost(ctx, values)
    ctx.provide(TUI_STARTUP_SERVICE, values)
  })
  parseCmdline(ctx, program)
}
