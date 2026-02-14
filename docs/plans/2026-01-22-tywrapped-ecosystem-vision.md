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

**Republish policy**: Every tywrap core release triggers regeneration and republish of all active packages with compound version. Users on any upstream version benefit from improvements.

**Version support breadth**: Separate indicator from quality tiers. Packages aim to match upstream's official support matrix (e.g., if numpy supports 1.24+, so does `@tywrapped/numpy`).

**Breaking changes**: Mirror upstream directly. No buffering, no parallel support periods. The wrapper is a transparent pass-through - breaking changes in numpy mean breaking changes in `@tywrapped/numpy`. Document this clearly so users understand they're accepting upstream's upgrade path.

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
| Standard | `latest+1` | Latest + previous major |
| Full | `upstream` | Matches upstream's support matrix |
| Extended | `upstream+LTS` | Upstream support + extended LTS |

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

**Override for power users:**

```typescript
import { setRuntime, InProcessBridge } from '@tywrapped/numpy';
setRuntime(new InProcessBridge()); // Use node-calls-python for speed
```

### Runtime Packages

Scope policy:
- `@tywrapped/*` are public library wrappers (e.g., `@tywrapped/numpy`, exports `setRuntime` and `InProcessBridge`)
- `@tywrap/*` are runtime and infrastructure packages (e.g., `@tywrap/runtime-subprocess`, `@tywrap/runtime-inprocess`, `@tywrap/runtime-pyodide`)

- `@tywrap/runtime-subprocess` - Bundled by default, no native dependencies
- `@tywrap/runtime-inprocess` - Optional, requires node-calls-python native addon
- `@tywrap/runtime-pyodide` - Auto-loaded in browser environments

### Browser Support

Opt-in per package, clearly marked.

Packages declare supported runtimes in metadata:
- `runtimes: ["node"]` - Node.js only (heavy libraries like PyTorch)
- `runtimes: ["node", "browser"]` - Both supported

Visible in README badge, npm package metadata, and package documentation.

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

### Trademark: Register Early

- File trademark application before public launch
- Estimated cost: $250-400 per class
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
