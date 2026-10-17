import { createUserMessage, MessageId , createMessage, AssistantStreamAccumulator, LlmAttemptId, ToolCallId, type AssistantStreamRecord, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import type { Terminal } from '@earendil-works/pi-tui'
import AgentRegistry, {
  agentEvents,
  type Agent,
  type AgentCancelCause,
  type AgentOptions,
  type AgentStatus,
} from '@deepseek-ai/dsh-agent'
import type {
  ContentBlock,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
} from '@deepseek-ai/dsh-llm'
import CommandService from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId, type Session, type SessionHeader, type UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import { createTuiChat, type Config, type TuiRuntime } from '../src/index.ts'
import { TestSessionQueryEngine } from './session-query.ts'
import TuiPromptService from '../src/prompt.ts'

interface FakeAgent extends Agent {
  status: AgentStatus
  sent: ContentBlock[][]
  sentMessages: UserMessage[]
  steered: ContentBlock[][]
  steeredIds: MessageId[]
  steeredOptions: UserMessage[]
  injected: ContentBlock[][]
  injectedOptions: UserMessage[]
  cancelled: AgentCancelCause[]
}

export interface TuiHarnessOptions {
  status?: AgentStatus
  config?: Config
  /** Leave the session event log empty instead of seeding one turn and step. */
  omitInitialLifecycle?: boolean
  /** Omit the harness's default `welcome`, exercising the banner sweep-reveal path. */
  omitWelcome?: boolean
  tools?: Record<string, ToolDefinition>
  configureContext?: (ctx: Context) => Promise<void>
  beforeMount?: (session: Session) => void
  cwd?: string | null
  formatCwd?: TuiRuntime['formatCwd']
  gitBranch?: TuiRuntime['gitBranch']
  /** Fake-agent creation options (`provider`/`model` seed the model selector's initial target). */
  agentOptions?: AgentOptions
  contextWindow?: number
  contextTokens?: number
  now?: () => number
  catalog?: {
    providers: LlmProviderInfo[]
    models: LlmModelInfo[]
    listModels?: (provider: string) => Promise<LlmModelInfo[]>
    resolveModelInfo?: (
      provider: string,
      model: string,
    ) => Promise<Pick<LlmResolvedModelInfo, 'context' | 'reasoning'>>
  }
  /** Provide a fake `sessionPersistence` service so resume surfaces can list sessions. */
  sessionPersistence?: {
    list(): Promise<SessionHeader[]>
    load?(id: ReturnType<typeof SessionId>): Promise<{ meta: SessionHeader; events: Session['events'] }>
    /** Per-session artifact location for mtime-based activity; defaults to none. */
    locate?(meta: SessionHeader): { kind: string; path: string } | undefined
  }
  handoffResume?: TuiRuntime['handoffResume']
  /** Host-supplied exit line; absent exercises the no-message path. */
  goodbyeMessage?: TuiRuntime['goodbyeMessage']
  /** Set false to exercise the optional session-query degradation path. */
  mountSessionQuery?: boolean
}

export interface TuiHarness<TerminalType extends Terminal, Exit extends (code: number) => void> {
  ctx: Context
  session: Session
  agent: FakeAgent
  terminal: TerminalType
  exit: Exit
  controller: ReturnType<typeof createTuiChat>
}

/**
 * Compose the production TUI around an in-memory session and controllable agent.
 * @param terminal - Terminal boundary driven by the test.
 * @param exit - Process-exit observer.
 * @param options - Initial session, agent, tool, and TUI configuration.
 * @returns The mounted TUI and every boundary the test may drive or inspect.
 */
export async function createTuiTestHarness<TerminalType extends Terminal, Exit extends (code: number) => void>(
  terminal: TerminalType,
  exit: Exit,
  options: TuiHarnessOptions = {},
): Promise<TuiHarness<TerminalType, Exit>> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandService)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(TuiPromptService)
  const catalog = options.catalog ?? {
    providers: [{ id: 'deepseek-official', name: 'DeepSeek' }],
    models: [
      { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    ],
  }
  ctx.provide('tokenMeter', {
    measure() {
      return { totalTokens: options.contextTokens ?? 0 }
    },
  } as never)
  if (options.configureContext === undefined) {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    for (const tool of Object.values(options.tools ?? {})) ctx.tools.register(tool)
  } else {
    await options.configureContext(ctx)
  }
  // A configureContext may mount the real LlmService; only fill the
  // advisory-catalog stub when none was provided.
  if (ctx.get('llm') === undefined) {
    ctx.provide('llm', {
      listProviders() {
        return catalog.providers.map(provider => ({ ...provider }))
      },
      listModels(provider: string) {
        return catalog.listModels?.(provider)
          ?? Promise.resolve(catalog.models.filter(model => model.provider === provider).map(model => ({ ...model })))
      },
      async resolveModelInfo(provider: string, model: string) {
        const advertised = catalog.models.find(candidate =>
          candidate.provider === provider && candidate.id === model)
        const capabilities = await (catalog.resolveModelInfo?.(provider, model)
          ?? Promise.resolve({
            context: { contextWindow: options.contextWindow ?? 128_000 },
          }))
        return {
          provider,
          id: model,
          name: advertised?.name ?? model,
          ...advertised?.description === undefined ? {} : { description: advertised.description },
          ...capabilities,
        }
      },
    } as never)
  }
  if (ctx.get('systemPrompt') === undefined) await ctx.plugin(SystemPrompt)
  if (options.sessionPersistence !== undefined) {
    const persistence = options.sessionPersistence
    // 0.2 exposes one handle-based contract: `list`/`stat` return
    // `SessionPersistenceSnapshot`s (header plus an opaque revision) and body
    // reads go through `open(...).read(...)`. The option keeps its historical
    // `list()`/`load()` shape so the resume suites read naturally; this adapter
    // is the single place that speaks the new wire format.
    const listHeaders = async (): Promise<SessionHeader[]> => persistence.list()
    const loadEvents = persistence.load === undefined
      ? (id: SessionId) => Promise.reject(new Error(`session "${id}" not found`))
      : (id: SessionId) => persistence.load!(id)
    const snapshotOf = (header: SessionHeader) => ({
      header,
      revision: SessionPersistenceRevision(`${header.id}@${header.createdAt}`),
    })
    // `stat` observes stored metadata only, so it reuses the most recent
    // listing instead of charging a second `list()` or reading a log; the
    // resume suites count `list()` and `load()` invocations.
    let listed: readonly SessionHeader[] = []
    ctx.provide('sessionPersistence', {
      async list() {
        listed = await listHeaders()
        return listed.map(snapshotOf)
      },
      async stat(id: SessionId) {
        const found = listed.find(header => header.id === id)
        return found === undefined ? undefined : snapshotOf(found)
      },
      async open(id: SessionId, access: string) {
        const loaded = await loadEvents(id)
        return {
          id: loaded.meta.id,
          header: loaded.meta,
          inheritedEventCount: 0,
          access,
          read: async () => ({ eventState: 'detached', events: loaded.events }),
          append: async () => { throw new Error('the test harness persistence is read-only') },
          flush: async () => {},
          close: async () => {},
        }
      },
      async create() { throw new Error('the test harness persistence does not create sessions') },
      async flush() {},
    } as never)
  }
  if (options.mountSessionQuery !== false && ctx.get('sessionQuery') === undefined) {
    await ctx.plugin(TestSessionQueryEngine)
  }
  const sessionId = SessionId('main-session')
  const session = ctx.sessions.create(
    sessionId,
    options.cwd === null ? undefined : { meta: { cwd: options.cwd ?? '/workspace' } },
  )
  if (options.omitInitialLifecycle !== true) {
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
  }
  options.beforeMount?.(session)
  const sent: ContentBlock[][] = []
  const sentMessages: UserMessage[] = []
  const steered: ContentBlock[][] = []
  const steeredIds: MessageId[] = []
  const steeredOptions: UserMessage[] = []
  const injected: ContentBlock[][] = []
  const injectedOptions: UserMessage[] = []
  const cancelled: AgentCancelCause[] = []
  const agent: FakeAgent = {
    id: sessionId,
    options: options.agentOptions ?? { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    session,
    inbox: {} as Agent['inbox'],
    status: options.status ?? 'idle',
    ctx,
    sent,
    sentMessages,
    steered,
    steeredIds,
    steeredOptions,
    injected,
    injectedOptions,
    cancelled,
    send(input) {
      sent.push(input.content)
      sentMessages.push(input)
    },
    followup(input) {
      sent.push(input.content)
      sentMessages.push(input)
    },
    steer(input) {
      steered.push(input.content)
      steeredOptions.push(input)
      steeredIds.push(input.id)
    },
    inject(input) {
      injected.push(input.content)
      injectedOptions.push(input)
    },
    cancel(cause) {
      cancelled.push(cause)
    },
    whenIdle() {
      return Promise.resolve()
    },
    runMaintenance(task) {
      return task(new AbortController().signal)
    },
  }
  ctx.agents.enter(agent, undefined)
  const controller = createTuiChat(ctx, Object.assign({
    ...options.omitWelcome === true ? {} : { welcome: 'Coding agent ready.' },
    sessionId,
    theme: { color: false },
    // Pin the language: the product default follows the process environment,
    // which would make every assertion depend on the developer's locale. A
    // suite that exercises another language overrides this through `config`.
    locale: 'en',
  }, options.config), {
    terminal,
    exit,
    // Default to the real clock (runtime.now falls back to Date.now) so the
    // elapsed-status suites can drive time via timers or Date.now spies; a
    // test pins the clock only by passing `now` explicitly.
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.formatCwd === undefined ? {} : { formatCwd: options.formatCwd }),
    ...(options.handoffResume === undefined ? {} : { handoffResume: options.handoffResume }),
    ...(options.goodbyeMessage === undefined ? {} : { goodbyeMessage: options.goodbyeMessage }),
    gitBranch: options.gitBranch ?? (() => 'tui-staging'),
  })
  return { ctx, session, agent, terminal, exit, controller }
}

/** Dispose the mounted TUI before its owning Cordis context. */
export async function disposeTuiTestHarness(
  setup: Pick<TuiHarness<Terminal, (code: number) => void>, 'controller' | 'ctx'>,
): Promise<void> {
  await setup.controller.dispose()
  await setup.ctx.fiber.dispose()
}

/** Append a production-shaped user message to the active session surface. */
export function appendUser(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/**
 * Publish one live assistant chunk exactly as the loop does in 0.2: a
 * process-local `agent/assistant-stream` frame, never a durable session event.
 * The durable log only gains the step's stream at settlement.
 * @param ctx - Context carrying the scoped agent event bus.
 * @param agent - The publishing agent.
 * @param index - Dense zero-based position within the current attempt.
 * @param time - Publication timestamp shared with the eventual durable stream.
 * @param chunk - The streamed chunk.
 */
export function emitLiveChunk(
  ctx: Context,
  agent: Agent,
  index: number,
  time: number,
  chunk: StreamChunk,
): void {
  agentEvents(ctx, agent).emit('agent/assistant-stream', {
    frame: {
      type: 'chunk',
      attemptId: LlmAttemptId('live-attempt'),
      revision: 1,
      index,
      time,
      chunk,
    },
  })
}

/** Append a production-shaped assistant message to the active session surface. */
export function appendAssistant(
  session: Session,
  content: ContentBlock[],
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
  position: { turn: number; step: number } = { turn: 1, step: 1 },
): void {
  const stream = buildAssistantStream(content, usage)
  session.append('assistant/message', {
    ...position,
    message: createMessage({
      role: 'assistant',
      content,
      source: { kind: 'model', provider: 'mock', model: 'deepseek-v4-flash' },
    }),
    stream,
    ...usage === undefined ? {} : { usage },
  }, { surfaceOp: 'append' })
}

/**
 * Append one `assistant/message` whose embedded stream is supplied chunk by
 * chunk, so timing consumers see the exact per-chunk times a real attempt logs.
 * @param session - Session to append to.
 * @param position - Turn/step coordinates.
 * @param chunks - Timed stream chunks in publication order.
 * @param content - Settled message content; defaults to no blocks.
 * @param usage - Optional settled usage.
 */
export function appendAssistantStream(
  session: Session,
  position: { turn: number; step: number },
  chunks: readonly { time: number; chunk: StreamChunk }[],
  content: ContentBlock[] = [],
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
): void {
  const accumulator = new AssistantStreamAccumulator()
  for (const { time, chunk } of chunks) accumulator.push({ time, chunk })
  session.append('assistant/message', {
    ...position,
    message: createMessage({
      role: 'assistant',
      content,
      source: { kind: 'model', provider: 'mock', model: 'deepseek-v4-flash' },
    }),
    stream: accumulator.snapshot(),
    ...usage === undefined ? {} : { usage },
  }, { surfaceOp: 'append' })
}

/**
 * Append one `assistant/attempt`: a model attempt that settled without
 * committing a surface message, carrying its own stream (and any usage).
 * @param session - Session to append to.
 * @param position - Turn/step coordinates.
 * @param chunks - Timed stream chunks in publication order.
 */
export function appendAssistantAttempt(
  session: Session,
  position: { turn: number; step: number },
  chunks: readonly { time: number; chunk: StreamChunk }[],
): void {
  const accumulator = new AssistantStreamAccumulator()
  for (const { time, chunk } of chunks) accumulator.push({ time, chunk })
  session.append('assistant/attempt', { ...position, stream: accumulator.snapshot() })
}

/**
 * Build a compact assistant stream faithful to `content` so timing and assembly
 * consumers (which read the durable `stream` rather than re-deriving from the
 * settled message) see a consistent attempt.
 */
export function buildAssistantStream(
  content: ContentBlock[],
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
): AssistantStreamRecord[] {
  const accumulator = new AssistantStreamAccumulator()
  content.forEach((block, index) => {
    accumulator.push({ time: 0, chunk: { type: 'block-start', index, blockType: block.type } })
    switch (block.type) {
      case 'text':
      case 'reasoning':
        accumulator.push({ time: 0, chunk: { type: 'text-delta', index, text: block.text } })
        break
      case 'tool-call':
        if (block.name !== '') {
          accumulator.push({ time: 0, chunk: { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments } })
        } else {
          accumulator.push({ time: 0, chunk: { type: 'tool-call-delta', index, id: block.id, argumentsDelta: block.arguments } })
        }
        break
      default:
        break
    }
    accumulator.push({ time: 0, chunk: { type: 'block-end', index, block } })
  })
  if (usage !== undefined) {
    accumulator.push({ time: 0, chunk: { type: 'usage', usage: { totalTokens: usage.inputTokens + usage.outputTokens, ...usage } } })
  }
  accumulator.push({ time: 0, chunk: { type: 'finish', reason: { kind: 'stop' } } })
  return accumulator.snapshot()
}
