/**
 * Host-side tests for dsh-plugin-rules, driven by a fake Cordis context with
 * the exact host shapes the plugin uses: a synchronous context provider, the
 * assemble waterfall, the command registry, and `agent.inject()`.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { apply, inject, name } from '../lib/index.js'

/** The rules asset the package ships. */
const ASSET = readFileSync(new URL('../assets/agent-rules.md', import.meta.url), 'utf8').trim()

/**
 * Build a fake host context that records the registrations `apply` makes.
 * @returns the context plus its recorded registrations.
 */
function fakeHost () {
  const contexts = new Map()
  const commands = new Map()
  const assemble = []
  const warnings = []
  const ctx = {
    logger: { warn: (line) => warnings.push(line) },
    effect: (fn) => fn(),
    on (event, listener) {
      if (event === 'system-prompt/assemble') assemble.push(listener)
      return () => {}
    },
    systemPrompt: {
      context (definition) {
        contexts.set(definition.name, definition)
        return () => contexts.delete(definition.name)
      },
    },
    commands: {
      register (definition) {
        commands.set(definition.name, definition)
        return () => commands.delete(definition.name)
      },
    },
  }
  return { ctx, contexts, commands, assemble, warnings }
}

/** An agent stand-in carrying one Session object and recording injections. */
function fakeAgent (session = {}) {
  const injected = []
  return { session, injected, inject: (message) => injected.push(message) }
}

test('the package metadata declares the plugin identity and services', () => {
  assert.equal(name, 'rules')
  assert.deepEqual(inject, ['commands', 'systemPrompt'])
})

test('the rules asset is non-empty', () => {
  assert.ok(ASSET.length > 100)
})

test('the context contribution is required, ordered, and uninterpolated', () => {
  const { ctx, contexts } = fakeHost()
  apply(ctx)
  const definition = contexts.get('operator:rules')
  assert.equal(definition.order, 220)
  assert.equal(definition.required, true)
  assert.equal(definition.interpolate, false)
  assert.equal(definition.text({}), '')
})

test('the assemble hook renders the snapshot the provider then serves', async () => {
  const { ctx, contexts, assemble } = fakeHost()
  apply(ctx)
  const session = {}
  const decision = { kind: 'enter', messages: [] }
  const listener = assemble[0]
  const returned = await listener({}, { agent: { session } }, async () => decision)
  assert.equal(returned, decision, 'the waterfall result is preserved')
  const text = contexts.get('operator:rules').text({ agent: { session } })
  assert.ok(text.startsWith('Standing rules from the operator'))
  assert.ok(text.includes(ASSET.split('\n')[0]), 'the asset text is carried')
})

test('snapshots are per-Session, not global', async () => {
  const { ctx, contexts, assemble } = fakeHost()
  apply(ctx)
  const rendered = {}
  const other = {}
  await assemble[0]({}, { agent: { session: rendered } }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(contexts.get('operator:rules').text({ agent: { session: { ...other } } }), '')
  assert.notEqual(contexts.get('operator:rules').text({ agent: { session: rendered } }), '')
})

test('/rules queues one frozen user message and confirms', () => {
  const { ctx, commands } = fakeHost()
  apply(ctx)
  const agent = fakeAgent()
  const result = commands.get('rules').handler({ agent })
  assert.deepEqual(result, { kind: 'success', text: 'The standing rules will be injected with the next step.' })
  assert.equal(agent.injected.length, 1)
  const [message] = agent.injected
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'operator-rules')
  assert.ok(Object.isFrozen(message))
  assert.ok(Object.isFrozen(message.content[0]))
  assert.ok(message.content[0].text.includes(ASSET.split('\n')[0]))
})

test('apply is inert without a Session and does not throw', async () => {
  const { ctx, assemble } = fakeHost()
  apply(ctx)
  const decision = { kind: 'reject' }
  const returned = await assemble[0]({}, {}, async () => decision)
  assert.equal(returned, decision)
})
