# Menagerie Discipline

The menagerie is the executable truth table for generation and codec behavior.
Its catalogue is `test/menagerie/manifest.ts`. It contains rows rather
than a claim that a broad type family works.

## A row

A runtime catalogue row describes one Python call under one codec path. It has
an `id`, fixture, call, expected result or error, status, and optional package
requirements. A row can select Arrow or JSON fallback. The test runs the call
through `NodeBridge`. It does not test a serializer in isolation.

The generation gate also generates and typechecks the tier-one fixture modules.
Optional-library tests add cases that require installed scientific packages.

## Statuses

| Status | Meaning | Obligation |
| --- | --- | --- |
| `EXPECTED_OK` | The call preserves the stated result. | Assert the exact value or declared structural expectation. |
| `KNOWN_LIE` | The current transport resolves but loses stated semantics. | Record the observed result and an `expectedFix`. Do not describe the behavior as lossless. |
| `LOUD_FAIL` | The call must reject at the bridge boundary. | Supply an error expectation. The test checks that error rows and this status stay aligned. |

`KNOWN_LIE` is documentation of a measured limitation, not a passing result to
silently improve. `LOUD_FAIL` is a contract that a value outside the supported
domain fails with an error that states the cause.

## Add or change a row

1. Add the fixture function in `test/menagerie/fixtures/` when needed.
2. Add one catalogue row in `test/menagerie/manifest.ts` with the codec,
   status, current behavior, and expectation.
3. Declare every optional library in `requires` and any feature condition in
   `featureProbe`.
4. Run `npm run test:menagerie` with the pinned dependencies below.
5. Update generated snapshots when the generation gate intentionally changes.

When behavior changes, flip the rows in the same PR. A fix that turns a
lossy result into a preserved result changes `KNOWN_LIE` to `EXPECTED_OK`; a
newly supported representation needs its own row. Do not leave the
catalogue describing yesterday's behavior.

## Pinned scientific job

GitHub Actions runs `optional-scientific-menagerie` on Python 3.11 and Node 22.
It installs `tywrap_ir`, then pins NumPy 2.3.5, pandas 3.0.2, pyarrow 24.0.0,
SciPy 1.16.3, scikit-learn 1.8.0, and CPU-only torch 2.10.0. The pins make a
truth-table change reviewable rather than a moving dependency result.

Run the same gate locally in a fresh virtual environment:

```bash
python3.11 -m venv .venv-menagerie
.venv-menagerie/bin/python -m pip install -e tywrap_ir
.venv-menagerie/bin/python -m pip install numpy==2.3.5 pandas==3.0.2 pyarrow==24.0.0 scipy==1.16.3 scikit-learn==1.8.0
.venv-menagerie/bin/python -m pip install torch==2.10.0 --index-url https://download.pytorch.org/whl/cpu
TYWRAP_CODEC_PYTHON=.venv-menagerie/bin/python npm run test:menagerie
```

The test skips a row only when its declared optional dependency or feature
probe is unavailable. The pinned CI job provides the expected scientific
surface for review.
