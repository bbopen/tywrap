# Watch & Reload (Failure / Recovery Contract)

`tywrap/dev` provides development-time wrapper regeneration plus runtime bridge
replacement. It does **not** provide application-level hot module reloading — it
keeps your generated wrappers and the active Python bridge in sync with your
Python sources while your process stays up.

This page documents the reload **lifecycle** and, in particular, the
**failure / recovery contract**: what happens when a reload fails, and what stays
live so your app keeps working.

> Reload is configured in code through `tywrap/dev`, never in `tywrap.config.*`.
> The legacy `development` block and `pythonModules.<module>.watch` fields were
> removed in 0.4.0; using them now raises an explicit migration error.

## The two entry points

| Helper | Use it for |
| --- | --- |
| `startNodeWatchSession(...)` | Node-only. Watches your config file and local Python sources, regenerates wrappers, and swaps the active bridge in place. |
| `createBridgeReloader(...)` | Cross-runtime manual primitive (e.g. Pyodide). You call `reload()` yourself; there is no filesystem watcher. |

```typescript
import { startNodeWatchSession } from 'tywrap/dev';
import { NodeBridge } from 'tywrap/node';

const session = await startNodeWatchSession({
  configFile: './tywrap.config.ts',
  createBridge: async config =>
    new NodeBridge({
      pythonPath: config.runtime.node?.pythonPath ?? 'python3',
      timeoutMs: config.runtime.node?.timeout ?? 30000,
    }),
});

// Force a rebuild now (resolves to `true` on success, `false` on failure):
const ok = await session.reloadNow();

// Stop watching and dispose the active bridge:
await session.close();
```

`createBridge` receives the **freshly resolved config for that reload cycle**, so
config edits (e.g. a changed `timeout`) are picked up on the next reload. By
default the newly created bridge is published to the global runtime registry, so
existing generated wrappers transparently route through the swapped bridge — no
imports change and the process never restarts.

## Reload lifecycle events

Pass an `onEvent` callback to observe the session. Events are emitted in this
order for a successful cycle:

| Event | Meaning |
| --- | --- |
| `watchPaths` | The set of paths the session is currently watching (config file, resolved Python package trees, and `extraWatchPaths`). Re-emitted whenever the watched set changes. |
| `change` | A watched path changed (`manual: false`) — a reload has been scheduled. |
| `reload-start` | A reload cycle began (`manual: true` for `reloadNow()` / initial startup). |
| `reload-success` | Regeneration and bridge swap completed. Carries `written` (relative paths of the generated files now on disk) and `warnings`. |
| `reload-error` | The reload failed. Carries the underlying `error: Error`. |

A reload performs these steps atomically with respect to the live state:

1. **Generate** the next wrapper set into a temporary staging directory.
2. **Promote** the staged files into the real output directory (writing new
   files, removing managed files that no longer exist).
3. **Warm and activate** the next bridge, then dispose the previous one.
4. **Commit** the refreshed watcher set and emit `reload-success`.

`reloadNow()` and filesystem changes are serialized: an in-flight reload
finishes before the next one starts, and rapid edits are debounced
(`debounceMs`, default `100`).

## Failure / recovery contract

If **any** step of a reload throws, the session does **not** tear down. The
last-known-good state stays live:

- The **previously generated wrappers remain on disk unchanged.** Staging happens
  in a temp directory; the real output directory is only touched once generation
  succeeds. If promotion itself fails partway, the previous file contents are
  restored.
- The **previously active bridge stays active** in the runtime registry and is
  **not disposed.** A bridge that was warmed for the failed reload is disposed
  instead, so you never leak the half-prepared one.
- A structured `reload-error` event is emitted with the underlying `Error`, and
  the failing call (`reloadNow()` or the debounced auto-reload) resolves to
  `false`. The session keeps watching and will attempt the next reload normally.

Two distinct failure sources surface the same way:

| Source | What the `error` looks like |
| --- | --- |
| **Generation failure** (a watched module's IR can't be produced — e.g. a syntax error). This is the `GenerateFailure` path. | `error.message` begins with `Generation failed for N module(s):` followed by per-module detail. |
| **Bridge construction failure** (your `createBridge` throws). | The error your factory threw, propagated verbatim. |

```typescript
const session = await startNodeWatchSession({
  configFile: './tywrap.config.ts',
  createBridge,
  onEvent: event => {
    if (event.type === 'reload-error') {
      // Last-good wrappers + bridge are still live here.
      console.error('[tywrap] reload failed, keeping last-good state:', event.error.message);
    }
    if (event.type === 'reload-success') {
      console.log('[tywrap] reloaded:', event.written.join(', '));
    }
  },
});
```

> **Startup is the exception.** There is no last-known-good state on the very
> first reload, so if the *initial* `startNodeWatchSession(...)` setup fails, the
> promise rejects (watchers are closed and any partial bridge disposed). After a
> successful start, every subsequent failure is recoverable as described above.

## Other notes

- Watched Python package trees are watched per-directory; new nested directories
  are picked up automatically and `__pycache__` / `.pytest_cache` /
  `.mypy_cache` / `.ruff_cache` churn is ignored.
- Writes into the output directory and `.tywrap/{cache,reports}` are ignored so
  generation does not retrigger itself.
- For Pyodide use `createBridgeReloader(...)` and drive `reload()` from your own
  trigger. For the HTTP runtime, reload by restarting/redeploying the remote
  server — that is external to tywrap.
