# Release

## Creating a Release

1. Ensure working tree is clean on main branch

2. Bump version and tag:
   ```sh
   node scripts/release.mjs <version> --commit --tag
   ```

3. Push:
   ```sh
   git push && git push --tags
   ```

## Version Format

- `X.Y.Z` - stable release
- `X.Y.Z-alpha.N` - alpha
- `X.Y.Z-beta.N` - beta
- `X.Y.Z-rc.N` - release candidate
