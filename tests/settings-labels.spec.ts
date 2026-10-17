/**
 * Display-name rules for the settings panel: curated titles copied from the
 * plugins' upstream locale dictionaries, identifier prettifying as the
 * fallback, and the process-locale selection that picks a language.
 */

import { describe, expect, it } from 'vitest'
import {
  enumLabel,
  fieldName,
  prettify,
  resolveLabelLanguage,
  sectionTitle,
} from '../src/settings/labels.ts'

describe('settings display names', () => {
  it('uses the upstream title for a known entry and prettifies an unknown one', () => {
    expect(sectionTitle('pwsh-sandbox', 'en')).toBe('PowerShell sandbox')
    expect(sectionTitle('pwsh-sandbox', 'zh')).toBe('PowerShell 沙箱执行')
    expect(sectionTitle('agent-default-model', 'zh')).toBe('默认模型')
    // An entry no table knows is prettified, never presented as an official name.
    expect(sectionTitle('my-custom-plugin', 'en')).toBe('My custom plugin')
    expect(sectionTitle('my-custom-plugin', 'zh')).toBe('My custom plugin')
  })

  it('names fields from the curated table, then by splitting the identifier', () => {
    expect(fieldName(['timeoutMs'], 'en')).toBe('Timeout (ms)')
    expect(fieldName(['timeoutMs'], 'zh')).toBe('超时（毫秒）')
    expect(fieldName(['maxParallelToolCalls'], 'en')).toBe('Max parallel tool calls')
    // Unknown keys still read as words rather than raw identifiers.
    expect(fieldName(['someNewKnob'], 'en')).toBe('Some new knob')
    expect(fieldName(['nested', 'innerValue'], 'en')).toBe('Inner value')
  })

  it('drops array indexes from a field name', () => {
    expect(fieldName(['rows', '0', 'name'], 'en')).toBe('Name')
    expect(fieldName(['models', '2'], 'en')).toBe('Models')
  })

  it('names the panel-own session rows in both languages', () => {
    expect(fieldName(['showReasoning'], 'en', true)).toBe('Show reasoning')
    expect(fieldName(['showReasoning'], 'zh', true)).toBe('显示推理过程')
    expect(fieldName(['toolCards'], 'zh', true)).toBe('工具卡片详细度')
  })

  it('translates the session row enum values', () => {
    expect(enumLabel('collapsed', 'zh')).toBe('折叠')
    expect(enumLabel('expanded', 'zh')).toBe('展开')
    expect(enumLabel('hidden', 'zh')).toBe('隐藏')
    // A value with no translation stays as stored.
    expect(enumLabel('browser', 'zh')).toBe('browser')
  })

  it('splits identifiers without losing acronyms', () => {
    expect(prettify('maxOutputBytes')).toBe('Max output bytes')
    expect(prettify('baseURL')).toBe('Base URL')
    expect(prettify('apiKey')).toBe('Api key')
    // Sentence case, like every other generated label; a leading acronym keeps
    // its capitals, a trailing one keeps them too.
    expect(prettify('UITheme')).toBe('UI theme')
    expect(prettify('snake_case_name')).toBe('Snake case name')
    expect(prettify('')).toBe('')
  })

  it('resolves the language from this package override or the process locale', () => {
    expect(resolveLabelLanguage({ DSH_TUI_LANG: 'zh' }, '')).toBe('zh')
    expect(resolveLabelLanguage({ DSH_TUI_LANG: 'zh-CN' }, '')).toBe('zh')
    expect(resolveLabelLanguage({ DSH_TUI_LANG: 'en' }, '')).toBe('en')
    expect(resolveLabelLanguage({ LANG: 'zh_CN.UTF-8' }, '')).toBe('zh')
    expect(resolveLabelLanguage({ LC_ALL: 'zh_TW.UTF-8', LANG: 'en_US.UTF-8' }, '')).toBe('zh')
    expect(resolveLabelLanguage({ LANG: 'en_US.UTF-8' }, '')).toBe('en')
    // An environment that names no locale delegates to the operating system,
    // which the caller supplies here so the assertion cannot depend on the
    // machine running the suite.
    expect(resolveLabelLanguage({}, '')).toBe('en')
    expect(resolveLabelLanguage({}, 'zh-CN')).toBe('zh')
  })
})
