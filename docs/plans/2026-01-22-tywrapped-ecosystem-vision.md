# RFC: @tywrapped Ecosystem

| | |
|---|---|
| **Status** | Draft |
| **Created** | 2026-01-22 |
| **Author** | @bbopen |

## Summary

Create a **curated ecosystem of pre-wrapped Python libraries** published to npm under the `@tywrapped` organization, making world-class Python libraries accessible to JavaScript/TypeScript developers who don't know Python.

## Motivation

JavaScript/TypeScript developers often need access to Python libraries that are best-in-class for their domain (PyTorch, NumPy, SciPy, scikit-learn). Currently, they must either:
1. Learn Python and manage a Python environment
2. Use inferior JS alternatives
3. Set up tywrap themselves

This RFC proposes a community-governed ecosystem of pre-built, tested, and versioned wrappers that "just work" via `npm install`.

## Goals

1. **Adoption friction** - Lower the barrier by providing ready-to-use npm packages instead of requiring users to run tywrap themselves
2. **Quality assurance** - Ensure high-quality, tested wrappers through governance and CI gates
3. **Discovery/Marketing** - Make tywrap visible in the npm ecosystem through packages like `@tywrapped/pytorch`
4. **Ecosystem sustainability** - Create a network effect where these become the "blessed" way to use Python libs from JS

## Target Audience

**JS/TS developers who don't know Python** and need access to libraries that are:
- Best-in-class for their domain (not just "best in Python")
- Have no well-maintained JS equivalent
- The primary project doesn't provide a JS SDK

## Unique Value Proposition

Tywrap is unique in the ecosystem:

| Project | Approach | Types | Existing Libraries |
|---------|----------|-------|-------------------|
| **tywrap** | Analyzes Python source → generates TS wrappers | Auto-generated | Yes, directly wraps numpy/pandas/etc. |
| **PyBridge** | Manual bridge | Manual TS interfaces | Requires wrapper functions |
| **pymport** | Embeds Python in-process | Minimal | Weak typing |
| **node-calls-python** | In-process execution | Basic conversions | No real TS types |

**Tywrap's unique combination:**
1. Auto-generates TypeScript types from Python source analysis
2. Wraps existing libraries directly (no wrapper functions needed)
3. Multi-runtime (Node.js subprocess AND browser via Pyodide)
4. Rich data science type mappings (numpy, pandas, torch, scipy, sklearn)

---

## Governance Model

### Organization Structure

- **Central branded org**: `@tywrapped` on npm, `tywrapped` on GitHub
- **Nonprofit/community-driven** structure that can receive sponsorship
- **Technical committee** provides governance and quality oversight
- Trust established via the central org, not individual maintainers

### Maintainer Model

- Trusted maintainers assigned to specific libraries
- Maintainers approve releases for their libraries
- Outreach to upstream Python projects welcomed but not required

### Upstream Relationship

| Level | Description |
|-------|-------------|
| **Awareness** | Default - notify upstream, they know we exist |
| **Collaboration** | Optional - they contribute to wrapper design |
| **Ownership** | Optional - upstream joins tywrap community as maintainer |

Upstream can "come to us" rather than requiring us to convince them.

---

## Package Naming

**Pattern**: `@tywrapped/<library>`

Examples:
- `@tywrapped/numpy`
- `@tywrapped/pytorch`
- `@tywrapped/scipy`
- `@tywrapped/beautifulsoup4`

**Rationale**:
- Scoped under org we control - prevents squatting
- Follows `@types/*` precedent (DefinitelyTyped)
- Clear this is community wrapper, not official
- Package naming, trademark strategy, and disclaimers must be reviewed by legal counsel before any public launch

**Required disclaimer in each package (draft, subject to legal review)**:
> This is a community-maintained wrapper and is not affiliated with or endorsed by [upstream project].

---

## Versioning Strategy

**Pattern**: Mirror upstream by default, compound version for tywrap patches.

| Scenario | Version |
|----------|---------|
| Wraps numpy 1.26.0 | `@tywrapped/numpy@1.26.0` |
| Tywrap fix for same numpy | `@tywrapped/numpy@1.26.0-tywrap.1` |
| New numpy release | `@tywrapped/numpy@1.26.1` (resets suffix) |

**Republish policy**: Every tywrap core release can trigger regeneration and republish of all active packages with a compound version so users on supported upstream versions benefit from improvements.

Operational scalability (suggested defaults):
- Canary wave: 5-10% of packages first; require green CI and no runtime regressions before expanding.
- Publish gating: require unit + integration smoke tests; fail-closed on flaky/timeout tests.
- Batching: cap concurrent publishes (e.g., 3-5) to avoid CI bottlenecks and npm rate limits.
- Rate limits: retry with exponential backoff (e.g., 5 retries, 30s → 5m); pause the queue on repeated 429s.
- Rollback: move dist-tags back to the last known-good build; open an incident issue and stop the wave.

**Version support breadth**: Separate indicator from quality tiers. Packages aim to match upstream's official support matrix (e.g., if numpy supports 1.24+, so does `@tywrapped/numpy`).

**Breaking changes**: Mirror upstream directly. No buffering, no parallel support periods. The wrapper is a transparent pass-through - breaking changes in numpy mean breaking changes in `@tywrapped/numpy`. Document this clearly so users understand they're accepting upstream's upgrade path.

### Enterprise stability options

- Optional channels: `stable`/`lts` dist-tags for org-blessed "slow lane" packages when demand justifies it; explicitly time-box support windows.
- Migration guides: require a short migration note for any breaking change (template + checklist) before publish.
- Pinning guidance (enterprise): prefer exact versions + lockfiles for production; treat `^` upgrades as opt-in.
- Trade-off: strict mirroring maximizes transparency and reduces maintainer load; stability channels increase operational overhead but improve adoption.

---

## Template Repository Structure

### Standardized Core (Fixed)

- GitHub Actions workflows (CI/CD)
- npm publish pipeline
- Health badge generation
- Dependabot configuration
- `tywrap.config.ts` structure
- CONTRIBUTING guidelines
- License (MIT)
- Disclaimer template

### Flexible Edges (Customizable)

- Library-specific integration tests
- Usage examples
- Extended documentation
- Custom TypeScript utilities on top of generated code

---

## CI/CD Pipeline

### Triggers

Releases triggered by **either**:
1. **Upstream Python release** - Dependabot detects new version
2. **Tywrap release** - New tywrap improves codegen

### Pipeline Flow

```text
1. Trigger (Dependabot or tywrap release)
	        ↓
2. CI regenerates wrappers
	        ↓
3. Run test suite (based on health tier)
	        ↓
4. If tests pass → Create PR / request approval
	        ↓
5. Library maintainer reviews/approves
	        ↓
6. Publish to npm
```

### Human Gate

Library maintainer must approve before publish - automation does the heavy lifting, humans ensure quality.

Fallbacks when maintainers are unavailable (suggested defaults):
- Minimum 2 maintainers per package (primary + backup).
- Patch releases: auto-approve after 72 hours with no response (logged), unless a maintainer vetoes.
- Security fixes: emergency override by technical committee (2-of-3) with mandatory postmortem.
- All overrides require a public audit trail (issue + PR link + rationale).

---

## Package Health Indicators

Two separate badge systems for orthogonal concerns:

### Quality Tier (testing depth)

| Tier | Badge | Requirement |
|------|-------|-------------|
| 🥉 Bronze | Generation + types | Wrappers generate, TypeScript compiles |
| 🥈 Silver | Smoke tests | Basic "does it call Python and return" tests |
| 🥇 Gold | Integration tests | Extensive API surface coverage |
| 💎 Platinum | Upstream parity | Ported subset of Python test suite |

### Support Breadth (version coverage)

| Level | Indicator | Meaning |
|-------|-----------|---------|
| Basic | `latest` | Only current upstream version |
| Standard | `latest-1` | Latest + previous major |
| Full | `upstream` | Matches upstream's support matrix |
| Extended | `upstream-lts` | Upstream support + extended LTS |

#### Implementation notes

Recommended approach: single package name + npm dist-tags.

- One package per library (e.g., `@tywrapped/numpy`) publishes multiple tested wrapper versions (mirroring upstream + `-tywrap.N` patches).
- Use dist-tags to make supported tracks easy to install:
  - `latest` → newest supported upstream release line
  - `latest-1` → previous major (or previous supported line)
  - `upstream` → "full matrix" track (only if you actually publish/test it)
  - `upstream-lts` → extended support line (explicitly time-boxed)
- Wrapper repo `package.json` stays straightforward: name is stable, version mirrors upstream with optional `-tywrap.N`, and `publishConfig.access` is public.

Publish/tag flow (sketch):

```bash
npm publish --tag latest
npm dist-tag add @tywrapped/numpy@1.26.0-tywrap.3 latest
npm dist-tag add @tywrapped/numpy@1.25.4-tywrap.2 latest-1
```

CI matrix outline (sketch):

```yaml
strategy:
  matrix:
    python: ["3.10", "3.11", "3.12"]
    upstream: ["numpy==1.24.*", "numpy==1.25.*", "numpy==1.26.*"]
```

Publish script logic (sketch):
1. Install target upstream version(s) into an isolated env (per matrix entry).
2. Generate wrappers (tywrap) and run the test tier for that package.
3. Compute package version (`<upstream>-tywrap.N`) and publish.
4. Apply/update dist-tags for the supported tracks.

User-facing installs:
- Default: `npm i @tywrapped/numpy` (uses `latest`)
- Specific track: `npm i @tywrapped/numpy@latest-1`
- Exact pin: `npm i @tywrapped/numpy@1.26.0-tywrap.3`

Alternative (if tags become unwieldy): separate packages per track (e.g., `@tywrapped/numpy-1.24`), at the cost of more maintenance and user confusion.

### Display Format

README example:

```markdown
@tywrapped/numpy
Quality: 🥇 Gold | Support: upstream (1.24+) | Runtimes: node, browser
```

### Progression Path

- All packages start at Bronze quality, Basic support
- Maintainers level up through added tests and version support
- LLM-assisted tooling can help port Python tests to TypeScript
- Health indicators create clear upgrade path and contribution opportunities

**Visibility**: Prominent in README, npm description, and searchable in package registry.

---

## Runtime Selection & Browser Support

### Auto-detection with Explicit Override

**Default behavior (zero config):**
- Browser environment → Pyodide runtime
- Node.js environment → Subprocess runtime (safest, no native deps)

**Override for power users (current tywrap API):**

```typescript
import { setRuntimeBridge, NodeBridge } from 'tywrap';

setRuntimeBridge(new NodeBridge()); // Explicit Node.js subprocess runtime
```

### Runtime Packages

Scope policy:
- `@tywrapped/*` are public library wrappers (e.g., `@tywrapped/numpy`, exports `setRuntime` and wrapper APIs)
- `@tywrap/*` are runtime and infrastructure packages (e.g., `@tywrap/runtime-subprocess`, `@tywrap/runtime-inprocess`, `@tywrap/runtime-pyodide`) and export runtime implementations like `InProcessBridge`

- `@tywrap/runtime-subprocess` - Bundled by default, no native dependencies
- `@tywrap/runtime-inprocess` - Optional, requires node-calls-python native addon
- `@tywrap/runtime-pyodide` - Auto-loaded in browser environments

### Browser Support

Opt-in per package, clearly marked.

Packages declare supported runtimes in metadata:
- `runtimes: ["node"]` - Node.js only (heavy libraries like PyTorch)
- `runtimes: ["node", "browser"]` - Both supported

Visible in README badge, npm package metadata, and package documentation.

#### Validation & enforcement (template repo)

- Automated validation: add a `browser-compat` CI job that runs bundler builds (esbuild/rollup/webpack) and Playwright smoke tests for packages that declare `runtimes: ["browser"]` (or `["node", "browser"]`).
- Enforcement at package boundary:
  - Build-time: fail CI if declared runtimes don't have matching artifacts/entry points.
  - Runtime: add a guard in Node-only entry points that throws a clear error when imported in the browser.
- Publish-time checks: lint `package.json` `runtimes`, generate README badges, and fail publish if declared runtime artifacts are missing.
- Pyodide handling: for browser-enabled packages, lazy-load Pyodide/WASM and keep heavy Python deps optional; include a headless-browser smoke test that imports the package and initializes the runtime.

---

## Initial Launch Libraries

Criteria for selection:
- High demand from JS developers
- No good existing JS alternative
- Reasonable API surface
- Good upstream test coverage

**Candidates**:

| Library | Domain | JS Alternative? | Priority |
|---------|--------|-----------------|----------|
| NumPy | Numerical computing | Limited (ndarray-js) | High |
| SciPy | Scientific computing | None comprehensive | High |
| PyTorch | ML/Deep learning | TensorFlow.js (different) | High |
| scikit-learn | Classical ML | None good | Medium |
| BeautifulSoup4 | HTML parsing | Cheerio (different API) | Medium |
| Pandas | Data manipulation | Danfo.js (less mature) | Medium |

---

## Funding & Brand Protection

### Funding Model: Open Collective

- Transparent finances - all income and expenses visible to community
- Fiscal host handles legal and tax compliance
- Proven model used by webpack, Babel, Vue, and similar projects
- Funds distributed to maintainers based on contribution
- Sponsors get visibility and community goodwill

**Fund allocation** (suggested starting point):
- 60% - Maintainer stipends (proportional to package maintenance)
- 20% - Infrastructure costs (CI, hosting, tooling)
- 15% - Bounties for new packages, test improvements, documentation
- 5% - Reserve for legal/unexpected expenses

#### Governance and Fund Allocation

- Decision body: technical committee + maintainers (define this in a governance charter).
- Maintainer stipends (60%): split using a simple, auditable formula (e.g., base stipend per maintained package + a variable component tied to monthly activity); publish the formula.
- Bounties (15%): bounties are proposed via issues, approved by the committee within a fixed SLA (e.g., 7 days), and paid on merge + release of the deliverable.
- Reserve (5%): only tapped for legal/incidents; require explicit approval (e.g., 2-of-3 committee vote) and a public rationale.
- Transparency: publish quarterly reports + a public ledger of disbursements; define a dispute-resolution path (mediation → committee decision → community escalation).

### Trademark: Register Early

- File trademark application before public launch
- Estimated cost (fees-only): ~$250-400 per class (USPTO filing fees); budget ~$1,200-3,000+ per class including search + attorney filing/prosecution and possible office actions
- Protects brand from squatting
- Establishes legitimacy for enterprise adoption
- Required classes: software development tools, software distribution

**Brand assets to protect**:
- "tywrapped" name
- `@tywrapped` npm scope (already protected by npm org ownership)
- Logo (when created)
- Domain name (tywrapped.org or similar)

---

## Runtime Abstraction Feasibility

### Current Architecture (Already Pluggable!)

The tywrap codebase already has a clean transport abstraction:

```text
┌─────────────────────────────────────────┐
│         Transport Interface             │
│  init() | send() | dispose() | isReady  │
└─────────────────┬───────────────────────┘
	                  │ implements
	      ┌───────────┼───────────┐
	      ▼           ▼           ▼
 ProcessIO    HttpIO    PyodideIO
 (subprocess) (HTTP)    (WASM)
```

**Key interface** (`src/runtime/transport.ts`):

```typescript
interface Transport extends Disposable {
  init(): Promise<void>;
  send(message: string, timeoutMs: number, signal?: AbortSignal): Promise<string>;
  readonly isReady: boolean;
}
```

`BridgeProtocol` is already transport-agnostic - it accepts any `Transport` implementation.

#### Large-data handling notes

The current `Transport` interface is string-based, which is great for simplicity but has practical limits for multi-GB tensors/DataFrames.

High-level strategies (future work):
- Binary channel: add optional `sendBinary(...)` support (or extend `send(...)` to accept `ArrayBuffer`) and use `Transferable` objects where available.
- Out-of-band transfer: for large payloads, send references (file paths, HTTP URLs, object-store URIs) instead of inlining data.
- Streaming/chunking: add `streamStart`/`streamChunk`/`streamEnd` semantics with backpressure and `AbortSignal`.
- Capability negotiation: have transports advertise features (binary/streaming) via a meta call (e.g., `getBridgeInfo()` capabilities).

### Adding node-calls-python Support

**Recommended approach: JSON passthrough**

1. Create `NodeCallsPythonIO implements Transport`
2. Keep the JSON protocol (parse incoming JSON, call Python via node-calls-python, serialize result)
3. Estimated ~200-300 lines of code
4. Small JSON overhead, but simpler integration and maintains consistency

### Implementation Estimate

| Task | Effort |
|------|--------|
| `NodeCallsPythonIO` transport class | 2-3 days |
| Bridge adapter for node-calls-python | 1 day |
| Integration tests | 1-2 days |
| Documentation | 0.5 day |
| **Total** | **~1-2 weeks (best-case)** |

Best-case assumes a stable `Transport` interface and no first-time runtime-integration surprises; budget extra buffer for native addon quirks, OS differences, and CI iteration.

### Conclusion

**No architectural changes needed.** The runtime abstraction already exists. Adding new runtimes is a matter of implementing the `Transport` interface.

---

## Next Steps

### Phase 1: Foundation (before launch)

1. Register "tywrapped" trademark
2. Set up GitHub org (`tywrapped`) and npm org (`@tywrapped`)
3. Create Open Collective account
4. Secure domain (tywrapped.org or similar)

### Phase 2: Template & Tooling

1. Create template repository with standardized CI/CD
2. Build badge generation tooling for health indicators
3. Document governance charter and contribution guidelines

### Phase 3: Proof of Concept

1. Build `@tywrapped/numpy` as first package
2. Validate CI/CD pipeline with real upstream updates
3. Gather feedback, iterate on template

### Phase 4: Expansion

1. Add 2-3 more high-priority packages (scipy, scikit-learn)
2. Recruit initial maintainers
3. Announce publicly, begin community building

### Optional (parallel track)

- Prototype `NodeCallsPythonIO` transport for performance optimization
- Explore LLM-assisted test porting from Python to TypeScript
