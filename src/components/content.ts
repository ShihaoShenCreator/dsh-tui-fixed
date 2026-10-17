/**
 * Content-block primitives shared across the terminal front door: flattening
 * session content to display text and parsing tool-call arguments.
 * @module @shihaoshen/dsh-tui-fixed/components/content
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'

const EMPTY_CONTENT: readonly ContentBlock[] = []

/**
 * Flatten content blocks into a single display string, recursing into nested
 * tool results and naming unknown block types.
 * @param content - Content blocks to flatten.
 * @returns The concatenated display text.
 */
export function contentText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        parts.push(block.text)
        break
      case 'tool-call':
        parts.push(`${block.name}(${block.arguments})`)
        break
      default: {
        // `tool-result` left the core block union in 0.2, but tool output is
        // merge-extensible and producers still nest results inside a result;
        // recurse when the payload is shaped that way instead of printing a
        // bare tag.
        const nested = nestedToolResultContent(block)
        if (nested !== undefined) {
          parts.push(contentText(nested))
          break
        }
        const rawType = (block as { type?: unknown }).type
        parts.push(`[${typeof rawType === 'string' ? rawType : 'content'}]`)
        break
      }
    }
  }
  return parts.join('')
}

/** Read the nested content of a `tool-result`-shaped block, or `undefined` when it is not one. */
function nestedToolResultContent(block: unknown): readonly ContentBlock[] | undefined {
  if (typeof block !== 'object' || block === null) return undefined
  const record = block as Record<string, unknown>
  if (record['type'] !== 'tool-result') return undefined
  return Array.isArray(record['content']) ? record['content'] as readonly ContentBlock[] : EMPTY_CONTENT
}

/** A tool call's arguments parsed from their JSON source, with a validity flag. */
export interface ParsedArguments {
  value: unknown
  valid: boolean
}

/**
 * Parse tool-call arguments from their JSON source.
 * @param raw - Raw JSON arguments text.
 * @returns The parsed value, or the raw text with `valid: false` on parse failure.
 */
export function parseArguments(raw: string): ParsedArguments {
  try {
    return { value: JSON.parse(raw), valid: true }
  } catch {
    return { value: raw, valid: false }
  }
}
