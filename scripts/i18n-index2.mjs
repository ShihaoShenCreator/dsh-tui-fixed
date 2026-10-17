import fs from 'node:fs'
const path = 'src/index.ts'
let c = fs.readFileSync(path, 'utf8')
const pairs = [
  ["renderPalette(palette, currentScheme, resolved.theme.color).join('\\n'), 0, 0,",
   "renderPalette(palette, currentScheme, resolved.theme.color, t).join('\\n'), 0, 0,"],
  ["    let context = `${formatDiagnosticNumber(usedContext)} used · capacity unknown`",
   "    let context = t('status.contextUnknown', { used: formatDiagnosticNumber(usedContext) })"],
  ["      context = `${diagnosticMeter(contextPercent, palette)} ${String(contextPercent)}% used (${formatDiagnosticNumber(usedContext)} / ${formatDiagnosticNumber(contextWindow)})`",
   "      context = `${diagnosticMeter(contextPercent, palette)} ${t('status.contextUsed', {\n        percent: contextPercent,\n        used: formatDiagnosticNumber(usedContext),\n        window: formatDiagnosticNumber(contextWindow),\n      })}`"],
  ["    const model = target.current === undefined ? 'unset' : displayText(targetLabel(target.current))",
   "    const model = target.current === undefined ? t('common.unset') : displayText(targetLabel(target.current))"],
  ["      ? 'unset'\n      : target.current.reasoningEffort === undefined\n        ? 'default'",
   "      ? t('common.unset')\n      : target.current.reasoningEffort === undefined\n        ? t('common.default')"],
  ["        ['Session', displayText(agent.session.id)],\n        ['Title', displayText(sessionTitle ?? 'untitled')],\n        ['Directory', displayText(cwd)],\n        ['Model', `${model} ${palette.dim(`(effort ${effort}; reasoning blocks ${showReasoning ? 'shown' : 'hidden'})`)}`],",
   "        [t('status.label.session'), displayText(agent.session.id)],\n        [t('status.label.title'), displayText(sessionTitle ?? t('common.untitled'))],\n        [t('status.label.directory'), displayText(cwd)],\n        [t('status.label.model'), `${model} ${palette.dim(t('status.effortAndReasoning', {\n          effort,\n          state: t(showReasoning ? 'common.shown' : 'common.hidden'),\n        }))}`],"],
  ["        ['Agent', [\n          agent.status,\n          formatDiagnosticCount(events.length, 'event'),\n          formatDiagnosticCount(turns, 'turn'),\n          formatDiagnosticCount(steps, 'step'),\n          formatDiagnosticCount(toolCalls, 'tool call'),\n        ].join(' · ')],",
   "        [t('status.label.agent'), [\n          agent.status,\n          t('count.event', { count: events.length }),\n          t('count.turn', { count: turns }),\n          t('count.step', { count: steps }),\n          t('count.toolCall', { count: toolCalls }),\n        ].join(' · ')],"],
  ["        ['Tokens', `${formatDiagnosticNumber(tokens.input)} input + ${formatDiagnosticNumber(tokens.output)} output`],\n        ['KV cache', rate === undefined\n          ? `n/a (${formatDiagnosticNumber(tokens.cacheRead)} read + ${formatDiagnosticNumber(tokens.cacheWrite)} write)`\n          : `${diagnosticMeter(rate, palette)} ${String(rate)}% hit (${formatDiagnosticNumber(tokens.cacheRead)} read + ${formatDiagnosticNumber(tokens.cacheWrite)} write)`],\n        ['Context', context],",
   "        [t('status.label.tokens'), t('status.tokensLine', {\n          input: formatDiagnosticNumber(tokens.input),\n          output: formatDiagnosticNumber(tokens.output),\n        })],\n        [t('status.label.kvCache'), rate === undefined\n          ? t('status.kvCacheNone', {\n            read: formatDiagnosticNumber(tokens.cacheRead),\n            write: formatDiagnosticNumber(tokens.cacheWrite),\n          })\n          : `${diagnosticMeter(rate, palette)} ${t('status.kvCacheHit', {\n            rate,\n            read: formatDiagnosticNumber(tokens.cacheRead),\n            write: formatDiagnosticNumber(tokens.cacheWrite),\n          })}`],\n        [t('status.label.context'), context],"],
  ["        ['Created', formatDiagnosticTime(agent.session.header.createdAt)],\n        ['Active', formatDiagnosticTime(latestActivity)],",
   "        [t('status.label.created'), formatDiagnosticTime(agent.session.header.createdAt)],\n        [t('status.label.active'), formatDiagnosticTime(latestActivity)],"],
  ["    chat.addChild(new Text(palette.bold(palette.accent('System prompt')), 0, 0))",
   "    chat.addChild(new Text(palette.bold(palette.accent(t('status.systemPrompt'))), 0, 0))"],
  ["    const systemPrompt = displayText(renderPrompt(assembly)) || '(empty)'\n    const registeredTools = assembly.tools.map(tool => displayText(tool.name)).join(', ') || '(none)'",
   "    const systemPrompt = displayText(renderPrompt(assembly)) || t('common.empty')\n    const registeredTools = assembly.tools.map(tool => displayText(tool.name)).join(', ') || t('common.none')"],
  ["    chat.addChild(new Text(palette.bold(palette.accent('Keyboard shortcuts')), 0, 0))",
   "    chat.addChild(new Text(palette.bold(palette.accent(t('help.title'))), 0, 0))"],
  ["      'Enter send • Shift/Alt+Enter newline • Up/Down prompt history',\n      'Esc cancel turn • Ctrl+O cycle cards (collapse/expand/hide) • Ctrl+R toggle reasoning • Ctrl+L redraw',\n      'Ctrl+C cancel while running; clear input or exit while idle • Ctrl+D exit',\n      '',\n      ...commandLines,\n      '/skill:<name> [instructions] — load a skill into the conversation',",
   "      t('help.keys'),\n      t('help.transcript'),\n      t('help.exit'),\n      '',\n      ...commandLines,\n      t('help.skill'),"],
  ["    chat.addChild(new Text(palette.bold(palette.accent('Registered tools')), 0, 0))",
   "    chat.addChild(new Text(palette.bold(palette.accent(t('status.registeredTools'))), 0, 0))"],
]
let replaced = 0
for (const [from, to] of pairs) {
  if (c.includes(from)) { c = c.split(from).join(to); replaced += 1 }
  else console.log('MISS:', JSON.stringify(from.slice(0, 70)))
}
fs.writeFileSync(path, c)
console.log(`replaced ${replaced}/${pairs.length}`)
