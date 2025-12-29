# Release

Use the release helper to bump versions, run checks, and optionally tag/publish.

## Typical flow

1. Ensure your working tree is clean.
2. Run the release helper:

```sh
node scripts/release.mjs <version> --commit --tag
```

3. Publish to npm when ready:

```sh
node scripts/release.mjs <version> --publish
```

## Options

- `--dry-run`: updates versions and runs checks, but skips git/npm side effects.
- `--allow-dirty`: allows running with uncommitted changes.
- `--commit`: creates a `release: vX.Y.Z` commit.
- `--tag`: creates a `vX.Y.Z` tag.
- `--publish`: runs `npm publish` (use after a successful tag/commit).

After tagging, push tags with:

```sh
git push --tags
```
