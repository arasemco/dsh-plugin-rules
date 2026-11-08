/**
 * dsh-plugin-rules — the operator's standing rules, in every prompt.
 *
 * The rules live in `assets/agent-rules.md` and are read when the prompt is
 * assembled. They ride in one runtime-context snapshot: the loop materializes it
 * as durable model history the first time a Session is driven, keeps it while
 * the text is unchanged, and appends a replacement only when the text changes.
 * Editing the asset therefore changes the next request with no restart.
 *
 * `/rules` queues a one-off copy as a user message on the next step, for the
 * turns where the standing context needs repeating. It uses `agent.inject()` so
 * the request never starts a new turn by itself.
 *
 * No @deepseek-ai/* imports: a profile plugin cannot resolve them from the
 * profile's node_modules, so services are used by name.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The rules asset shipped beside this module. */
const RULES_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'agent-rules.md')

/** The runtime-context contribution carrying the rules, and its placement. */
const CONTEXT = 'operator:rules'
const CONTEXT_ORDER = 220

/** Last rendered snapshot per live Session; the context provider is synchronous. */
const snapshotBySession = new WeakMap()

export const name = 'rules'

export const inject = ['commands', 'systemPrompt']

/**
 * Read the rules asset.
 * @returns the trimmed rules text, or '' when the asset cannot be read.
 */
function rulesText () {
  try {
    return readFileSync(RULES_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * The snapshot text of the rules context contribution.
 * @param text - rendered rules.
 * @returns the snapshot, or '' when there are no rules.
 */
function contextText (text) {
  if (text === '') return ''
  return `Standing rules from the operator, in force for this Session; the newest snapshot wins.\n\n${text}`
}

/**
 * Build the model-visible user message a manual injection carries.
 * @param text - the exact model-facing text.
 * @returns the identified frozen message.
 */
function rulesMessage (text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'operator-rules' }),
  })
}

/**
 * Register the rules context provider, the render hook, and `/rules`.
 * @param ctx - host context carrying the commands and system-prompt services.
 */
export function apply (ctx) {
  let warned = false

  /**
   * Report an unreadable asset once, without breaking prompt assembly.
   */
  function warnOnce () {
    if (warned) return
    warned = true
    ctx.logger?.warn?.(`dsh-plugin-rules: ${RULES_FILE} is unreadable; no rules are injected`)
  }

  ctx.systemPrompt.context({
    name: CONTEXT,
    order: CONTEXT_ORDER,
    required: true,
    interpolate: false,
    /* Synchronous: serves the snapshot the assemble hook below rendered for this Session. */
    text: (context) => {
      const session = context.agent?.session
      return session === undefined ? '' : snapshotBySession.get(session) ?? ''
    },
  })

  /* Rendered before the step's request is admitted: the loop re-resolves the
     context providers through refreshContext, so this step carries the fresh
     snapshot. A Session's snapshot is replaced only when its text changes. */
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const session = context.agent?.session
    if (session === undefined) return next()
    const text = rulesText()
    if (text === '') warnOnce()
    snapshotBySession.set(session, contextText(text))
    return next()
  })

  ctx.effect(() => ctx.commands.register({
    name: 'rules',
    description: 'Queue the operator standing rules for the next step',
    handler: (invocation) => {
      const text = rulesText()
      if (text === '') return { kind: 'error', text: 'The rules asset is unreadable.' }
      invocation.agent.inject(rulesMessage(contextText(text)))
      return { kind: 'success', text: 'The standing rules will be injected with the next step.' }
    },
  }), 'dsh-plugin-rules: /rules')
}
