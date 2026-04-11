# Release

## tywrap (npm)

1. Ensure the working tree is clean and `main` is up to date.

2. Check the release-please branch or PR for the next npm release. Verify:
   - `package.json`
   - `package-lock.json`
   - `src/index.ts`
   - `CHANGELOG.md`

3. Run the release gate in CI-style mode:
   ```sh
   CI=1 npm run check:all
   ```

4. Merge the release-please branch or PR to `main`. The [`release.yml`](../.github/workflows/release.yml)
   workflow creates the npm tag and publishes the package.

5. If release-please is unavailable, use the manual fallback:
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
