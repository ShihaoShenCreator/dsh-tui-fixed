import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Locate the sibling harness checkout that owns the vendored Loader. The
 * directory is version-suffixed and machine-specific, so discover it rather
 * than hard-coding a name; a standalone checkout of this package simply has no
 * sibling and skips the probe.
 * @returns absolute sibling root, or `undefined` when none is present.
 */
function siblingHarnessRoot(): string | undefined {
  const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const candidates = readdirSync(workspace, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('deepseek-harness'))
    .map(entry => join(workspace, entry.name))
  return candidates.find(candidate =>
    existsSync(join(candidate, 'vendor', 'loader', 'src', 'index.ts'))
    && existsSync(join(candidate, 'node_modules', 'tsx', 'dist', 'cli.mjs')))
}

/** Real Loader export-path guard for the namespace TUI plugin. */
describe('dsh-tui plugin export shape', () => {
  const harness = siblingHarnessRoot()
  const root = dirname(dirname(fileURLToPath(import.meta.url)))

  it.skipIf(harness === undefined)('preserves name, inject, Config, and apply through Loader unwrapping', () => {
    // The sibling harness owns TypeScript source resolution for its private
    // workspace packages. Probe through its source launcher so this external
    // package never mixes harness source and built faces in Vite's program.
    // Its `.bin/tsx` is an extensionless POSIX shim that Windows cannot spawn,
    // so drive the shipped CLI module through the current Node instead. The
    // cwd is the harness root because its `tsconfig.base.json` aliases
    // `@deepseek-ai/cordis` to `vendor/cordis/src`; without those aliases the
    // vendored Loader would import this package's published cordis build.
    const tsx = join(harness as string, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const harnessRoot = harness as string
    const tuiEntry = pathToFileURL(join(root, 'src', 'index.ts')).href
    const loaderSpecifier = pathToFileURL(join(harnessRoot, 'vendor', 'loader', 'src', 'index.ts')).href
    const script = `
Promise.all([
  import(${JSON.stringify(tuiEntry)}),
  import(${JSON.stringify(loaderSpecifier)}),
]).then(([tui, loaderModule]) => {
  const loader = Object.create(loaderModule.default.prototype)
  const unwrapped = loader.unwrapExports(tui)
  console.log(JSON.stringify({
    same: unwrapped === tui,
    hasDefault: 'default' in tui,
    name: unwrapped.name,
    inject: unwrapped.inject,
    config: unwrapped.Config !== undefined,
    apply: typeof unwrapped.apply,
  }))
})
`
    const result = spawnSync(process.execPath, [tsx, '--eval', script], { cwd: harnessRoot, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toEqual({
      same: true,
      hasDefault: false,
      name: 'ui-tui',
      inject: [
        'agents',
        'sessions',
        'commands',
        'userQuestions',
        'tools',
        'llm',
        'systemPrompt',
        'tokenMeter',
        'tuiPrompt',
      ],
      config: true,
      apply: 'function',
    })
  })
})
