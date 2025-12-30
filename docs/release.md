# Release

## Release Process

1. Ensure your working tree is clean and on main branch.

2. Bump version and create tag:

```sh
node scripts/release.mjs <version> --commit --tag
```

3. Push:

```sh
git push && git push --tags
```

The CI workflow will run tests and publish automatically.

## Version Format

Versions follow [semver](https://semver.org/):

- `X.Y.Z` - stable release
- `X.Y.Z-alpha.N` - alpha pre-release
- `X.Y.Z-beta.N` - beta pre-release
- `X.Y.Z-rc.N` - release candidate

## Release Script Options

- `--dry-run` - run checks without git/npm side effects
- `--allow-dirty` - allow uncommitted changes
- `--commit` - create release commit
- `--tag` - create version tag
- `--publish` - run npm publish (for manual releases)
