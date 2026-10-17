import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { StepTimingTracker } from '../src/chat/timing.ts'

/** One assistant/message event carrying a timed durable stream. */
function messageEvent(
  turn: number,
  step: number,
  seq: number,
  time: number,
  chunks: readonly { time: number; chunk: StreamChunk }[],
): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn,
      step,
      message: createAssistantMessage({ content: [{ type: 'text', text: '' }], source: { provider: 'p', model: 'm' } }),
      stream: chunks.map(({ time: t, chunk }) => ({ type: 'chunk', time: t, chunk })),
    },
  } as SessionEvent
}

/** One completed two-phase step plus a tool call, in event-log order. */
function stepEvents(turn: number, step: number, base: number, seq: number): SessionEvent[] {
  return [
    { type: 'step/start', seq: seq, time: base, data: { turn, step } },
    messageEvent(turn, step, seq + 1, base + 100, [
      { time: base + 100, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
      { time: base + 300, chunk: { type: 'text-delta', index: 1, text: 'hi' } },
    ]),
    { type: 'tool/call', seq: seq + 3, time: base + 450, data: { turn, step, callId: 'call-1', name: 'bash', arguments: '{}' } },
    { type: 'step/end', seq: seq + 4, time: base + 700, data: { turn, step } },
  ] as SessionEvent[]
}

describe('StepTimingTracker', () => {
  it('accumulates each phase from the step lifecycle', () => {
    const tracker = new StepTimingTracker()
    const events = stepEvents(1, 1, 1_000, 0)
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 2_000)).toEqual({
      ttft: 100, // step/start -> first chunk
      thinking: 200, // reasoning block-start -> text delta
      responding: 150, // text delta -> tool call
      tools: 250, // tool call -> step/end
    })
  })

  it('returns empty totals for a step that never started', () => {
    const tracker = new StepTimingTracker()
    expect(tracker.totalsAt(stepEvents(1, 1, 1_000, 0), { turn: 9, step: 9 }, 2_000)).toEqual({
      ttft: 0, thinking: 0, responding: 0, tools: 0,
    })
  })

  it('accumulates the open bucket to the query clock without mutating tracked state', () => {
    const tracker = new StepTimingTracker()
    const events = [
      { type: 'step/start', seq: 0, time: 1_000, data: { turn: 1, step: 1 } },
    ] as SessionEvent[]
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 1_250).ttft).toBe(250)
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 1_400).ttft).toBe(400)
  })

  it('matches a fresh replay when queried incrementally across appends', () => {
    const incremental = new StepTimingTracker()
    const first = stepEvents(1, 1, 1_000, 0)
    incremental.totalsAt(first, { turn: 1, step: 1 }, 5_000)
    const events = [...first, ...stepEvents(1, 2, 3_000, first.length)]
    const fresh = new StepTimingTracker()
    for (const position of [{ turn: 1, step: 1 }, { turn: 1, step: 2 }]) {
      expect(incremental.totalsAt(events, position, 5_000)).toEqual(fresh.totalsAt(events, position, 5_000))
    }
  })

  it('serves interleaved steps from one shared scan', () => {
    const tracker = new StepTimingTracker()
    const events = [
      { type: 'step/start', seq: 0, time: 1_000, data: { turn: 1, step: 1 } },
      { type: 'step/start', seq: 1, time: 1_100, data: { turn: 1, step: 2 } },
      messageEvent(1, 2, 2, 1_200, [
        { time: 1_200, chunk: { type: 'text-delta', index: 0, text: 'x' } },
      ]),
      { type: 'step/end', seq: 3, time: 1_500, data: { turn: 1, step: 2 } },
      { type: 'step/end', seq: 4, time: 1_600, data: { turn: 1, step: 1 } },
    ] as SessionEvent[]
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 9_000)).toEqual({ ttft: 600, thinking: 0, responding: 0, tools: 0 })
    expect(tracker.totalsAt(events, { turn: 1, step: 2 }, 9_000)).toEqual({ ttft: 100, thinking: 0, responding: 300, tools: 0 })
  })

  it('keeps the first step/start when a duplicate arrives while the step is open', () => {
    const tracker = new StepTimingTracker()
    const events = [
      { type: 'step/start', seq: 0, time: 1_000, data: { turn: 1, step: 1 } },
      { type: 'step/start', seq: 1, time: 1_500, data: { turn: 1, step: 1 } },
    ] as SessionEvent[]
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 2_000).ttft).toBe(1_000)
  })

  it('ignores same-coordinate events after the step closed', () => {
    const tracker = new StepTimingTracker()
    const events = [
      ...stepEvents(1, 1, 1_000, 0),
      // A stray duplicate start and a late chunk reuse the coordinates; the
      // closed step's totals stay pinned.
      { type: 'step/start', seq: 5, time: 9_000, data: { turn: 1, step: 1 } },
      messageEvent(1, 1, 6, 9_100, [
        { time: 9_100, chunk: { type: 'text-delta', index: 0, text: 'late' } },
      ]),
    ] as SessionEvent[]
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 10_000)).toEqual({
      ttft: 100, thinking: 200, responding: 150, tools: 250,
    })
  })

  it('keeps the live overlay idempotent across repeated renders of the same clock', () => {
    // The status prompt re-queries the open step every animation tick (~20 fps),
    // so a live chunk must contribute its span once per clock, not once per
    // render.
    const tracker = new StepTimingTracker()
    const events = [
      { type: 'step/start', seq: 0, time: 1_000, data: { turn: 1, step: 1 } },
    ] as SessionEvent[]
    const live = [
      { time: 1_500, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } as StreamChunk },
      { time: 2_500, chunk: { type: 'text-delta', index: 1, text: 'answer' } as StreamChunk },
    ]
    const lookup = (): typeof live => live
    const first = tracker.totalsAt(events, { turn: 1, step: 1 }, 3_000, lookup)
    expect(first).toEqual({ ttft: 500, thinking: 1_000, responding: 500, tools: 0 })
    for (let render = 0; render < 5; render += 1) {
      expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 3_000, lookup)).toEqual(first)
    }
    // The open bucket still advances with the wall clock between ticks.
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 3_400, lookup))
      .toEqual({ ttft: 500, thinking: 1_000, responding: 900, tools: 0 })
    // A single query on a fresh tracker sees the same overlay.
    expect(new StepTimingTracker().totalsAt(events, { turn: 1, step: 1 }, 3_000, lookup)).toEqual(first)
  })

  it('drops the live overlay without polluting the durable totals', () => {
    const tracker = new StepTimingTracker()
    const live = [
      { time: 1_500, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } as StreamChunk },
      { time: 2_500, chunk: { type: 'text-delta', index: 1, text: 'answer' } as StreamChunk },
    ]
    const events = [
      { type: 'step/start', seq: 0, time: 1_000, data: { turn: 1, step: 1 } },
    ] as SessionEvent[]
    // Render the in-flight attempt several times before settlement.
    for (let render = 0; render < 3; render += 1) {
      expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 3_000, () => live))
        .toEqual({ ttft: 500, thinking: 1_000, responding: 500, tools: 0 })
    }
    events.push(messageEvent(1, 1, 1, 3_000, live))
    // Settlement drops the overlay: the durable stream alone owns the step.
    const settled = tracker.totalsAt(events, { turn: 1, step: 1 }, 3_000, () => undefined)
    expect(settled).toEqual({ ttft: 500, thinking: 1_000, responding: 500, tools: 0 })
    expect(new StepTimingTracker().totalsAt(events, { turn: 1, step: 1 }, 3_000))
      .toEqual(settled)
  })
})
