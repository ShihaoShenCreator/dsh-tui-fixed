/**
 * CJK layout probe: the Chinese dictionary changes the *width* of every label,
 * not just its text, so wrapping, truncation, and the bordered dialogs are the
 * parts a translation can break. These render each localized surface at a narrow
 * terminal and assert that no row exceeds its width — the failure mode being a
 * box that overflows or a row that wraps into the frame below it.
 *
 * Widths are measured with `get-east-asian-width` semantics through pi-tui's own
 * `visibleWidth`, the same function the renderers use, so a disagreement here
 * would be a real disagreement on screen.
 */

import { describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import {
  DetailsDialog,
  EffortDialog,
  ModelDialog,
  QuestionDialog,
  ResumePicker,
  StatusCardComponent,
  effortChoices,
  summarizeResumeCandidate,
  type ModelChoice,
  type StatusCardRow,
} from '../src/components/dialogs.ts'
import { ContextCardComponent, ToolCardComponent } from '../src/components/transcript.ts'
import { SettingsDialog } from '../src/components/settings-dialog.ts'
import { parseArguments } from '../src/components/content.ts'
import { createPalette, markdownTheme, renderPalette } from '../src/components/theme.ts'
import { createTranslator } from '../src/i18n/translate.ts'
import { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import type { SettingsDialogDeps } from '../src/components/settings-dialog.ts'
import type { SettingsSection } from '../src/settings/schema-form.ts'

const palette = createPalette(false)
const mdTheme = markdownTheme(palette)
const zh = createTranslator('zh')
const en = createTranslator('en')

/** Every row of a rendered frame must fit the width it was asked for. */
function expectFits(rows: readonly string[], width: number, label: string): void {
  for (const [index, row] of rows.entries()) {
    expect(visibleWidth(row), `${label} row ${index}: ${JSON.stringify(row)}`).toBeLessThanOrEqual(width)
  }
}

/** The frame is a bordered dialog, so its rows share one exact width. */
function expectUniformWidth(rows: readonly string[], label: string): void {
  const widths = new Set(rows.map(row => visibleWidth(row)))
  expect(widths.size, `${label} row widths: ${[...widths].join(', ')}`).toBe(1)
}

function record(id: string, cwd = '/workspace'): SessionRecord {
  return {
    header: { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1, cwd, isSeeded: false },
    live: false,
    persisted: true,
  } as never
}

const modelChoices: readonly ModelChoice[] = [
  {
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    modelName: 'DeepSeek V4 Pro',
    description: '通用旗舰模型，适合复杂的长任务与多步工具调用',
    reasoning: {
      defaultEffort: undefined,
      efforts: [
        { id: 'high', name: '高' },
        { id: 'max', name: '最高' },
      ],
    } as never,
  },
  { provider: 'local', model: 'tiny', modelName: '厂商自带的本地小模型' },
]

const question: AskUserQuestionItem = {
  id: 'question-1',
  question: '是否把这次改动拆成两个提交，先落地国际化的框架，再补齐全部中文文案？',
  header: '发布方式',
  multiSelect: false,
  options: [
    { label: '拆成两个提交', description: '先合并框架，再合并文案，便于逐条回看' },
    { label: '合成一个提交', description: '整体一次落地，历史更短但单次改动更大' },
  ],
}

const statusGroups: readonly (readonly StatusCardRow[])[] = [
  [
    ['会话', 'main'],
    ['标题', '终端界面国际化支持'],
    ['目录', '/workspace/project'],
    ['模型', 'deepseek-official/deepseek-v4-pro（推理强度 默认；推理块已显示）'],
  ],
  [
    ['Agent', 'running · 7 个事件 · 1 轮次 · 1 个步骤 · 2 次工具调用'],
  ],
  [
    ['Token', '输入 1,250 + 输出 340'],
    ['KV Cache', '80% 命中（读取 3,000 + 写入 250）'],
    ['上下文', '已用 33%（42,000 / 128,000）'],
  ],
  [
    ['创建于', '2026-07-22 09:10:11 UTC'],
    ['最近活动', '2026-07-22 09:20:11 UTC'],
  ],
]

describe('Chinese layout stays inside its frame', () => {
  it('sizes the status card to its translated labels', () => {
    for (const width of [60, 76, 96]) {
      const rows = new StatusCardComponent(statusGroups, palette, zh.t('status.cardTitle')).render(width)
      expectFits(rows, width, `status card @${width}`)
      expectUniformWidth(rows, `status card @${width}`)
      expect(rows[0]).toContain(zh.t('status.cardTitle'))
    }
  })

  it('renders the model, effort, and details selectors inside their borders', () => {
    for (const width of [60, 76, 96]) {
      const model = new ModelDialog(modelChoices, undefined, 8, palette, () => {}, () => {}, zh.t).render(width)
      expectFits(model, width, `model dialog @${width}`)
      expectUniformWidth(model, `model dialog @${width}`)
      expect(model.join('\n')).toContain(zh.t('model.selectTitle'))

      const efforts = effortChoices(modelChoices[0]?.reasoning, zh.t)
      const effort = new EffortDialog(efforts, undefined, 8, palette, () => {}, () => {}, zh.t).render(width)
      expectFits(effort, width, `effort dialog @${width}`)
      expectUniformWidth(effort, `effort dialog @${width}`)
      // The default row is translated, not "Default".
      expect(effort.join('\n')).toContain(zh.t('common.default'))

      const details = new DetailsDialog('collapsed', true, palette, () => {}, () => {}, zh.t).render(width)
      expectFits(details, width, `details dialog @${width}`)
      expectUniformWidth(details, `details dialog @${width}`)
      expect(details.join('\n')).toContain(zh.t('details.title'))
    }
  })

  it('renders the resume picker at full terminal width in both scopes', () => {
    const candidates = [
      summarizeResumeCandidate(record('newer'), '把吞吐率改成按路由学习，并在状态行显示实时速率', 2_000, SessionId('current'), '/workspace', () => '/workspace', zh.t),
      summarizeResumeCandidate(record('older'), undefined, 500, SessionId('current'), '/workspace', () => '~/.dsh/另一个工作区', zh.t),
      summarizeResumeCandidate(record('current'), '当前会话', 100, SessionId('current'), '/workspace', () => '/workspace', zh.t),
    ]
    for (const width of [40, 60, 96]) {
      const picker = new ResumePicker(candidates, 8, '/workspace', () => 30, palette, () => {}, () => {}, zh.t)
      expectFits(picker.render(width), width, `resume picker @${width}`)
      // Tab widens the scope, which adds a per-row workspace line.
      picker.handleInput('\t')
      expectFits(picker.render(width), width, `resume picker all-workspaces @${width}`)
      expect(picker.render(width).join('\n')).toContain(zh.t('resume.title'))
    }
  })

  it('renders the question dialog inside the minimum width', () => {
    // The smallest supported question dialog is deliberately tight: the footer
    // and header must compact rather than overflow.
    for (const width of [24, 40, 76]) {
      const rows = new QuestionDialog(question, 1, 2, 2, 8, () => 20, palette, () => {}, () => {}, zh.t)
        .render(width)
      expectFits(rows, width, `question dialog @${width}`)
    }
    const wide = new QuestionDialog(question, 1, 2, 2, 8, () => 20, palette, () => {}, () => {}, zh.t).render(96)
    expect(wide.join('\n')).toContain(zh.t('question.enterSubmit'))
    expect(wide.join('\n')).toContain('问题 1/2（2 个未作答）')
  })

  it('renders the settings panel with Chinese section names and rows', () => {
    const sections: readonly SettingsSection[] = [
      {
        id: 'pwsh-sandbox',
        title: 'PowerShell 沙箱执行',
        kind: 'host',
        revision: 1,
        value: { timeoutMs: 120_000 },
        user: { timeoutMs: 120_000 },
        writable: true,
        fields: [
          { path: ['timeoutMs'], kind: 'number', label: '超时（毫秒）' },
          { path: ['maxOutputBytes'], kind: 'number', label: '输出上限（字节）' },
        ],
      },
      {
        id: 'tui-session',
        title: '终端（本会话）',
        kind: 'local',
        revision: 0,
        value: { showReasoning: true },
        user: {},
        writable: true,
        fields: [{ path: ['showReasoning'], kind: 'boolean', label: '显示推理过程' }],
      },
    ]
    const deps: SettingsDialogDeps = {
      palette,
      maxFields: 10,
      documentLabel: zh.t('settings.document', { path: '/home/user/.dsh/profiles/tui/cordis.patch.yml' }),
      translator: zh,
      commit: async () => {},
      close: () => {},
    }
    for (const width of [50, 72, 96]) {
      const rows = new SettingsDialog(sections, deps).render(width)
      expectFits(rows, width, `settings dialog @${width}`)
      expectUniformWidth(rows, `settings dialog @${width}`)
      expect(rows.join('\n')).toContain(zh.t('settings.title'))
    }
  })

  it('renders tool and context cards with translated headers at every visibility', () => {
    for (const width of [40, 80]) {
      const card = new ToolCardComponent(
        'bash',
        parseArguments('{"command":"pnpm test"}'),
        undefined,
        4,
        2_000,
        palette,
        mdTheme,
        zh.t,
      )
      for (const visibility of ['collapsed', 'expanded', 'hidden'] as const) {
        card.setVisibility(visibility)
        expectFits(card.render(width), width, `tool card ${visibility} @${width}`)
      }
      const context = new ContextCardComponent('workspace-context', '注入的上下文正文\n第二行', 4, palette, zh.t)
      expectFits(context.render(width), width, `context card @${width}`)
      expect(context.render(width)[0]).toContain('上下文 · workspace-context')
    }
  })

  it('renders the palette listing without overflowing a narrow pane', async () => {
    // `/palette` prints its rows through one `Text`, which owns wrapping; the
    // probe therefore measures the same thing the transcript does.
    const { Text } = await import('@earendil-works/pi-tui')
    for (const width of [40, 80]) {
      for (const scheme of ['dark', 'light'] as const) {
        const rows = new Text(renderPalette(palette, scheme, true, zh.t).join('\n'), 0, 0).render(width)
        expectFits(rows, width, `palette ${scheme} @${width}`)
      }
    }
    // English keeps the same rows; only the copy differs.
    expect(renderPalette(palette, 'dark', true, en.t).join('\n')).toContain(en.t('palette.title'))
  })
})
