# Codebase Review & Refactor Plan — 2026-05-29

A two-stage analysis of `tywrap`, reconciled against the maintainer's open roadmap issues (#228–#238).

## Read in this order

1. **[02-refactor-plan.md](02-refactor-plan.md)** — **start here.** The reconciled plan: theme→issue map (9
   themes incl. T9 vocabulary), the #238 analyzer conflict resolution, the **single decisive breaking-release
   sequence**, per-theme detail, the 24-entry false-positive ledger, and the coverage gaps. (Two factual
   errors corrected inline on 2026-05-29 by the hardened review below — marked `[CORRECTED 2026-05-29]`.)
2. **[03-hardened-review.md](03-hardened-review.md)** — the **codex-paired second review.** `codex exec` ran
   as an adversarial reviewer on all 8 themes + a plan-level sparring pass. Holds the two must-fix
   corrections, the 24-entry disagreement ledger (where codex changed the plan), 13 new risks, the
   **comments & readability charter**, and the resolved `bridge-core` → `RpcClient` fork. Raw codex
   transcripts in [`codex-audits/`](codex-audits/). **Read before executing any theme.**
3. **[04-bridge-architecture-decision.md](04-bridge-architecture-decision.md)** — the **bridge-architecture
   final decision** from a team workflow (4 investigators + 2 independent codex passes). Settles which layer is
   live vs dead, picks the 4-concept composition architecture (Bridge → RpcClient → BridgeCodec + Transport),
   and lists keep/rename/deprecate/delete + the Pyodide-parity milestone-zero. Raw codex transcripts in
   [`codex-audits/bridge-team/`](codex-audits/bridge-team/).
4. **[glossary.md](glossary.md)** — the **T9 vocabulary standardization**: the four-layer naming model and
   the current→new rename table that the big-bang release applies (also codex-reviewed).
5. **[01-expert-review.md](01-expert-review.md)** — the upstream input: a 10-reviewer expert synthesis with
   per-dimension grades, quick wins, and the A–H prioritized roadmap.
6. **[architect-verdicts/](architect-verdicts/)** — 8 per-theme architect agents (each verified the review
   against source and recorded refutations) + `00-sequencing.json` (the cross-cutting release pass) +
   `refactor-synthesis.json` (rolled-up index). These hold the full `proposal`/`breakingChanges`/`steps`.
7. **[signals/](signals/)** — `ts-fx` static signals (complexity, dead-code, duplicates, layering, ESM
   checks) as NDJSON, two human-readable digests, and `github-issues-digest.md` (the 11 roadmap issues).

## How it was produced

- **Stage 1 (expert review):** a workflow fanned out 10 domain reviewers (architecture, code quality,
  correctness, tests, security, perf, Python, docs, marketing) over the codebase + `ts-fx` signals, then a
  lead reviewer deduplicated and synthesized → `01-expert-review.md`.
- **Stage 2 (refactor plan):** a second workflow ran one architect per refactoring theme. Each was grounded
  in the expert review + verified signals and **required to verify every claim against source** (file:line
  evidence) and refute what didn't hold. A final sequencing agent ordered the themes into a release plan.
- **Reconciliation (this session):** the 8 verdicts + sequencing were reconciled against the 11 maintainer
  roadmap issues. Headline finding: the refactor work is **#236-stabilization in scope**, not the "0.5.0" the
  workflow named it — the maintainer has reserved **0.5.0 for the data plane (#237)**, which the refactor
  workflow did not plan.
- **Hardening + decisions (this session):** a codex-paired review (`03`) corrected two factual errors and
  resolved the `bridge-core` fork. The maintainer then made two calls: **(1)** ship **one decisive
  major-version-breaking release** (no staging/back-compat), and **(2)** add **T9 — a vocabulary cleanup**
  (`glossary.md`) standardizing the vibe-coded names. Both are folded into the plan.

## Headline conclusions

- All 8 original themes are **DO IT** (every core claim verified against source); **T9 vocabulary** is added
  as the 9th.
- **#238 (p1, remove TS analyzer + tree-sitter)** is fully covered by `delete-dead-code` + `python-ir`, and
  the architects already resolved the apparent conflict where `decompose-hotspots` had targeted the
  soon-to-be-deleted `analyzer.ts`.
- **Decided:** one big-bang breaking release labeled **`0.5.0`** (all 9 themes). The data plane (#231–#235),
  originally roadmapped as 0.5.0, **shifts to `0.6.0`** and follows on this clean foundation, gated by the
  expert review's D1 ("measure first"). `ROADMAP.md` needs that relabel at execution time.
- **codex earned its keep:** caught a build-break (missing dead-test file) and a factual error (`@classmethod`
  is dropped, not "mislabeled") that would have shipped broken/wrong code; see `03` §2.
- **Bridge architecture (team-decided, `04`):** the maintainer's recollection was *inverted* — verified
  decisively (commit `5405343`) that `BridgeProtocol`/`Transport` is the **live** architecture and `BridgeCore`
  is the **dead** predecessor. But the instinct to overhaul was right: the live layer leaks RPC stubs across
  **three** files via inheritance and ships a second, impoverished Pyodide Python server. Final direction:
  a 4-concept **composition** architecture (Bridge → RpcClient → BridgeCodec + Transport), with Pyodide
  protocol parity as milestone zero behind a cross-backend conformance suite.
