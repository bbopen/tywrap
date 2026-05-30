**(a) Diagnosis**

Mostly confirm for the call-prelude and guards, but refute the stronger load-bearing hypothesis because overloads are not mechanically identical.

The prelude shape is mechanically the same for real callables: `let __kwargs = kwargs`, build `__args`, trim trailing `undefined`, maybe peel a trailing kwargs object, then normalize `*args`. Compare functions at `src/core/generator.ts:531`, methods at `src/core/generator.ts:800`, and constructors at `src/core/generator.ts:998`. The six `as any` casts are exactly the same emission role at `src/core/generator.ts:555`, `573`, `824`, `844`, `1022`, `1040`.

The guard blocks are also mechanically identical modulo indent and error label: positional-only guard at `src/core/generator.ts:496`, `859`, `1054`; required kw-only guard at `src/core/generator.ts:508`, `873`, `1068`.

The descriptor computations are substantially duplicated: filtered params / kw-only / pos-only / kwargs / varargs / positional params at `src/core/generator.ts:348`, `715`, `916`; `kwargsType` at `src/core/generator.ts:368`, `736`, `938`.

But overloads are not identical. Free functions have an extra optional-positional overload branch when there are no varargs/kwargs: `else if (firstOptionalIndex >= 0 && !varArgsParam && !needsKwargsParam)` at `src/core/generator.ts:476`. Methods and constructors only emit required-kwonly overloads at `src/core/generator.ts:774` and `src/core/generator.ts:967`; they do not have the optional-tail branch. That is a real per-site asymmetry, not indent/error/RPC.

There is also a constructor special case with no `__init__`: it emits `...args: unknown[]` and `const __args: unknown[] = [...args];` without the descriptor path at `src/core/generator.ts:903`. A shared constructor path must preserve that.

**(b) Refactor Critique**

Descriptor + shape is the right direction for `emitCallPrelude` and `emitArgGuards`. I would not include overloads in the same “mechanically identical modulo three params” claim unless the emitter explicitly models site-specific signature rendering and the free-function-only optional-tail branch.

A safer shape:

- `buildCallDescriptor(filteredParams, renderType, escapeIdentifier)` returns normalized call facts plus `kwargsType`.
- `emitCallPrelude(descriptor, { indent, errorLabel })`
- `emitArgGuards(descriptor, { indent, errorLabel })`
- Keep declaration/implementation signatures and terminal call statements at each call site.
- Make overload extraction separate, with explicit options like `kind: 'function' | 'method' | 'constructor'` and `includeOptionalTailOverloads`.

Splitting into `src/core/emit-call.ts` is worth it if it stays pure and small. The risk is that `buildCallDescriptor` needs `escapeIdentifier`, type rendering, generic context, and the existing private `renderLooksLikeKwargsExpr` at `src/core/generator.ts:308`; moving too much out may create a callback-heavy helper that is harder to read than private methods on `CodeGenerator`.

The `as any` -> `as Record<string, unknown>` follow-up is not safe as “change only the cast.” Runtime APIs do expect `Record<string, unknown>` (`src/types/index.ts:427`, `src/runtime/bounded-context.ts:577`), but generated `let __kwargs = kwargs;` infers the narrower `kwargsType`, e.g. `{ "c": number } | undefined` from `src/core/generator.ts:408`. Assigning `Record<string, unknown>` into that local can type-error for keyword-only params without `**kwargs`. The safe version likely needs to widen the local too: `let __kwargs: Record<string, unknown> | undefined = kwargs;`, which is a larger emitted-byte change.

Characterization snapshots are mandatory. Existing `test/generated_snapshot.test.ts:16` only checks substrings through `:24`, so it will miss whitespace, overload order, and declaration/body drift.

**(c) Readability Comments To Add**

Add a module header in `src/core/emit-call.ts`:

```ts
// This module emits generated TypeScript source text. Whitespace and line order
// are part of the public generated-output contract; do not reformat casually.
```

Above `CallDescriptor` in `src/core/emit-call.ts`:

```ts
// Normalized Python callable shape used by all wrapper call sites. These fields
// describe generated-call behavior, not runtime values in this generator process.
```

Above `CallSiteShape`:

```ts
// Per-call-site emission details. `indent` is literal emitted whitespace, and
// `errorLabel` is the Python-facing name used in generated runtime errors.
```

Above `renderLooksLikeKwargsExpr` if moved, or at `src/core/generator.ts:308` if kept:

```ts
// Heuristic for ambiguous trailing plain objects: treat as kwargs only when the
// object has required/known keyword-only keys, or when **kwargs accepts any key.
```

Above `emitCallPrelude`:

```ts
// Builds generated __args/__kwargs marshalling. Trailing undefined values are
// trimmed so omitted optional TS args preserve Python defaults.
```

Inside `emitCallPrelude`, before the `needsVarArgsArray` branch:

```ts
// TypeScript rest params cannot be followed by kwargs, so *args becomes an
// array surrogate whenever kwargs may also be passed.
```

Above `emitOverloads`, if extracted:

```ts
// Emits declaration overloads only. Preserve the legacy asymmetry: free
// functions also get optional-tail overloads without kwargs/varargs; class
// methods and constructors currently do not.
```

Verdict: MIXED on the diagnosis.