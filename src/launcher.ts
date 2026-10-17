/**
 * Launcher-side facts for the terminal app: how to re-invoke the `dsh`
 * launcher that booted this process, the in-place resume handoff that replaces
 * this TUI with a runtime for a selected session in that session's own
 * workspace, and the exit line naming how to come back to a session.
 *
 * The facts are derived from `profileContext`, which a `dsh` launcher provides
 * before any Loader entry mounts. A process booted without one — an embedding,
 * a test harness, or a host that cannot replace itself — gets no host at all,
 * which is exactly what the TUI reports as "this host cannot hand it off in
 * place".
 *
 * The handoff is deliberately blocking: the resume controller has already
 * released the terminal, so the replacement process inherits it and this
 * process only mirrors its exit status. A failure to start the replacement
 * rejects before the exit boundary, letting the caller restore its own terminal
 * and report.
 * @module @shihaoshen/dsh-tui-fixed/launcher
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TuiResumeHost } from './runtime.ts'

/** How to re-invoke the dsh launcher that booted this profile. */
export interface LauncherInvocation {
  /** Executable to run — the interpreter hosting the launcher. */
  readonly command: string
  /** Arguments before the app's own flag family, including the launcher entry. */
  readonly args: readonly string[]
}

/**
 * The launcher facts a profile boot supplies. Both fields come from the
 * profile's `profileContext`; a process booted without one can neither hand a
 * session off nor name a resume command.
 */
export interface LauncherEnvironment {
  /** Profile name this process booted, e.g. `tui`. */
  readonly profile: string
  /** Path of the booted dsh application package's `package.json`. */
  readonly installAnchor: string | undefined
}

/**
 * Read the launcher facts out of a context. `profileContext` is provided by the
 * dsh launcher and typed by `@deepseek-ai/dsh-app-boot`, which this package
 * deliberately does not depend on: the read is structural, and a boot without
 * the service yields `undefined`.
 * @param ctx - the plugin context carrying optional launcher state.
 * @returns the environment, or `undefined` outside a dsh-launched profile.
 */
export function launcherEnvironment(ctx: {
  get(name: string, strict?: boolean): unknown
}): LauncherEnvironment | undefined {
  const profileContext = ctx.get('profileContext', false) as {
    name?: unknown
    installAnchor?: unknown
  } | undefined
  if (profileContext === undefined || typeof profileContext.name !== 'string') return undefined
  return {
    profile: profileContext.name,
    installAnchor: typeof profileContext.installAnchor === 'string'
      ? profileContext.installAnchor
      : undefined,
  }
}

/** Spawn boundary used by the handoff; replaceable by tests. */
export type SpawnSyncBoundary = (
  command: string,
  args: readonly string[],
  options: { cwd: string; stdio: 'inherit' },
) => { error?: Error; status: number | null }

/**
 * Process facts that identify the launcher this process is running. Every field
 * defaults to this process's own value; a test or an embedding may state them
 * explicitly, and `entry: undefined` states that no entry can be replayed.
 */
export interface LauncherProcess {
  /** Interpreter executable hosting the launcher. */
  readonly execPath?: string
  /** Launcher entry module; `undefined` means this process has none to replay. */
  readonly entry?: string | undefined
  /** Interpreter arguments that must precede the entry. */
  readonly execArgv?: readonly string[]
}

/**
 * Resolve the command that re-invokes this process's dsh launcher.
 *
 * The launcher entry this process is actually running (`process.argv[1]`) wins,
 * because the same `dsh` package can be hosted by different carriers — a plain
 * Node installation, a source launch, or the packaged Desktop CLI, which passes
 * `--expose-internals` and runs its own entry module. Replaying that entry with
 * the current interpreter and exec arguments reproduces the invocation that
 * booted this process instead of guessing at a manifest bin. The manifest bin
 * is the fallback for a process whose entry cannot be identified (for example
 * `node -e`).
 * @param installAnchor - absolute path of the dsh app package's `package.json`.
 * @param processFacts - interpreter, entry, and interpreter arguments; omitted reads this process.
 * @returns the invocation, or `undefined` when neither source supplies one.
 */
export function resolveLauncherInvocation(
  installAnchor: string | undefined,
  processFacts: LauncherProcess = {},
): LauncherInvocation | undefined {
  const execPath = processFacts.execPath ?? process.execPath
  const entry = 'entry' in processFacts ? processFacts.entry : process.argv[1]
  const execArgv = processFacts.execArgv ?? process.execArgv
  if (entry !== undefined && entry !== '' && isAbsolute(entry) && existsSync(entry)
    && ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'].some(extension => entry.endsWith(extension))) {
    return { command: execPath, args: [...execArgv, entry] }
  }
  if (installAnchor === undefined) return undefined
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(installAnchor, 'utf8'))
  } catch {
    return undefined
  }
  const bin = (manifest as { bin?: unknown }).bin
  const relative = typeof bin === 'string'
    ? bin
    : typeof bin === 'object' && bin !== null && typeof (bin as Record<string, unknown>).dsh === 'string'
      ? (bin as Record<string, string>).dsh
      : undefined
  /* v8 ignore next -- an anchored dsh package always declares its dsh bin. */
  if (relative === undefined) return undefined
  return { command: execPath, args: [...execArgv, resolve(dirname(installAnchor), relative)] }
}

/** The line the TUI prints on exit, naming the command that resumes the session. */
export function formatGoodbyeMessage(profile: string, sessionId: SessionId): string {
  return `To resume this session: dsh --profile ${profile} --resume ${sessionId}`
}

/** Collaborators for the in-place resume host. */
export interface ResumeHostOptions {
  /** How to re-invoke the launcher. */
  readonly invocation: LauncherInvocation
  /** Profile name the replacement process boots. */
  readonly profile: string
  /** Spawn boundary; defaults to synchronous spawn with inherited stdio. */
  readonly spawn?: SpawnSyncBoundary
  /**
   * Exit boundary reached after the replacement process ends. The default ends
   * this process with the same status; a boundary that returns rejects instead,
   * so the caller reports the handoff as failed rather than silently resuming
   * its own loop.
   */
  readonly exit?: (code: number) => void
}

/**
 * Build the resume host: re-run the launcher resuming `sessionId` in the
 * session's own workspace and mirror its exit status. Success does not return.
 *
 * Node has no `execve`, so replacement is a blocking child that inherits this
 * terminal while the parent — already idle, flushed, and out of raw mode — only
 * waits and forwards the status. Spawning before any teardown keeps a failed
 * start recoverable: the caller can still restore its terminal and report.
 * @param options - invocation, profile, and the spawn/exit boundaries.
 * @returns the host the TUI's `/resume` handoff calls.
 */
export function createResumeHost(options: ResumeHostOptions): TuiResumeHost {
  const spawn = options.spawn ?? ((command, args, spawnOptions) =>
    spawnSync(command, [...args], spawnOptions))
  const exit = options.exit ?? ((code: number) => { process.exit(code) })
  /**
   * Re-exec the launcher with `args` in `cwd`, then mirror the replacement's
   * exit status. A start failure rejects; a launcher that returns without the
   * exit boundary committing rejects as a failed handoff.
   */
  const launch = (args: readonly string[], cwd: string): Promise<never> =>
    new Promise<never>((_resolve, reject) => {
      let result: { error?: Error; status: number | null }
      try {
        result = spawn(options.invocation.command, args, { cwd, stdio: 'inherit' })
      } catch (error: unknown) {
        reject(new Error(`cannot re-exec the dsh launcher: ${error instanceof Error ? error.message : String(error)}`))
        return
      }
      if (result.error !== undefined) {
        reject(new Error(`cannot re-exec the dsh launcher: ${result.error.message}`))
        return
      }
      const status = result.status ?? 1
      exit(status)
      reject(new Error(`launcher exited with status ${status} without replacing this process`))
    })
  return {
    handoff(sessionId, cwd) {
      return launch(
        [...options.invocation.args, '--profile', options.profile, '--resume', sessionId],
        cwd,
      )
    },
  }
}
