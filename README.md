# dsh-plugin-rules

The operator's standing rules, carried in the runtime context of every prompt of
a Session.

`assets/agent-rules.md` is read when the prompt is assembled and materialized as
one durable runtime-context snapshot: the loop keeps it while the text is
unchanged and appends a replacement only when the text changes. Editing the asset
changes the next request with no restart, and opening a Session again does not
re-send the rules.

`/rules` queues a one-off copy as a user message on the next step (via
`agent.inject()`), for the moments the standing context needs repeating.

Feedback — the ratings folded into the model's steering, `/ratings`, and
`/userfeedback` — is a separate package, `dsh-plugin-feedback`.

## Install

```sh
dsh plugin --profile web add /path/to/plugin/rules
```

The package declares `dsh.bundle.patch`, so the install composes this row:

```yaml
- insert:
    - id: rules
      name: dsh-plugin-rules
```

## Test

```sh
node --test test/host.test.mjs
```

## Configuration

None. The rules live in the asset, one file, one source of truth.
