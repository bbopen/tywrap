# Release

## tywrap (npm)

Releases publish from `main` via the [`release.yml`](../.github/workflows/release.yml)
workflow. There is one path: bump the version on a branch, merge to `main`, and the
workflow tags, releases, and publishes.

1. On a release branch, bump the version and update the changelog:
   - `package.json` — the new `version`
   - `CHANGELOG.md` — add a `## [X.Y.Z](…compare/vPREV...vX.Y.Z) (DATE)` section
     (the workflow extracts the GitHub release notes from this exact header)
   - `src/version.ts` — regenerate with `npm run build:version` (single-sourced
     from `package.json`)
   - `package-lock.json` — refresh if dependencies changed

2. Run the release gate:
   ```sh
   CI=1 npm run check:all
   ```

3. Open a PR, get CI green, and merge to `main`. On that push `release.yml`
   detects that `main` carries an unreleased `package.json` version with a
   matching `CHANGELOG.md` section and no existing tag, then tags `vX.Y.Z`,
   creates the GitHub release from that changelog section, and publishes to npm.

4. npm publishing uses npm trusted publishing (OIDC) from GitHub Actions — keep
   the package connected to this repository as a trusted publisher, and do not
   add a publish token to the workflow. The publish job validates on Node 22,
   then switches to Node 24 for the final `npm publish --provenance` step so npm
   uses an OIDC-capable CLI.

5. To (re)publish an already-tagged version without changing `main`, run the
   `Release` workflow manually with `publish_tag=vX.Y.Z`.

6. If GitHub Actions release automation is unavailable, use the manual fallback:
   ```sh
   node scripts/release.mjs <version> --commit --tag
   git push && git push --tags
   ```

## tywrap-ir (PyPI)

1. Bump both exported package-version references:
   - `tywrap_ir/pyproject.toml`
   - `tywrap_ir/tywrap_ir/__init__.py`

2. Keep `IR_VERSION` in `tywrap_ir/tywrap_ir/__init__.py` aligned with the
   current IR schema used by `src/tywrap.ts`.

3. Validate the Python package:
   ```sh
   python -m venv .venv-release
   ./.venv-release/bin/python -m pip install -e tywrap_ir
   PATH="$PWD/.venv-release/bin:$PATH" python -m unittest discover -s tywrap_ir/tests -p 'test_*.py' -v
   ```

4. Tag the merged `main` commit and push the tag:
   ```sh
   git tag tywrap-ir-v<version>
   git push origin tywrap-ir-v<version>
   ```

5. The [`publish-pypi.yml`](../.github/workflows/publish-pypi.yml) workflow
   publishes `tywrap-ir` to PyPI from that tag.

## Notes

- `tywrap` and `tywrap-ir` are versioned independently.
- `tywrap` release tags use `vX.Y.Z`.
- `tywrap-ir` release tags use `tywrap-ir-vX.Y.Z`.

## Version Format

- `X.Y.Z` - stable release
- `X.Y.Z-alpha.N` - alpha
- `X.Y.Z-beta.N` - beta
- `X.Y.Z-rc.N` - release candidate
