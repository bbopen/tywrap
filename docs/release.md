# Release

tywrap supports two release methods: automated CI publishing (recommended) and manual local publishing.

## Automated Release (Recommended)

The recommended way to publish is through GitHub Actions with OIDC Trusted Publishing, which provides:
- **No token management** - OIDC handles authentication automatically
- Full test matrix validation before publish
- npm provenance for supply chain security
- Automatic GitHub Release creation

### Setup (One-time)

1. **Configure Trusted Publisher on npmjs.com**:
   - Go to [npmjs.com](https://www.npmjs.com/) → Your packages → tywrap → Settings
   - Scroll to "Trusted Publisher" section
   - Click "GitHub Actions"
   - Fill in:
     - **Organization or user:** `bbopen`
     - **Repository:** `tywrap`
     - **Workflow filename:** `publish.yml`
     - **Environment name:** `npm` (optional)
   - Click "Set up connection"

2. **Create GitHub Environment** (optional, for extra protection):
   - Go to Settings → Environments → New environment
   - Name: `npm`
   - Add protection rules (e.g., required reviewers)

> **Note:** With OIDC trusted publishing, you do NOT need to create or store an NPM_TOKEN secret. Authentication is handled automatically via GitHub's OIDC provider.

### Release Process

1. Ensure your working tree is clean and on main branch.

2. Run the release helper to bump version and create a tag:

```sh
node scripts/release.mjs <version> --commit --tag
```

3. Push the commit and tag:

```sh
git push && git push --tags
```

4. The `publish.yml` workflow automatically:
   - Runs full test matrix (Node 20/22, Python 3.10-3.12, macOS/Windows/Ubuntu)
   - Publishes to npm with provenance
   - Creates a GitHub Release with auto-generated notes

### Dry Run

To test the workflow without publishing:

1. Go to Actions → "Publish to npm" → "Run workflow"
2. Check "Dry run" checkbox
3. Click "Run workflow"

---

## Manual Release (Alternative)

For local publishing without CI:

### Typical flow

1. Ensure your working tree is clean.
2. Run the release helper:

```sh
node scripts/release.mjs <version> --commit --tag
```

3. Publish to npm when ready:

```sh
node scripts/release.mjs <version> --publish
```

### Options

- `--dry-run`: updates versions and runs checks, but skips git/npm side effects.
- `--allow-dirty`: allows running with uncommitted changes.
- `--commit`: creates a `release: vX.Y.Z` commit.
- `--tag`: creates a `vX.Y.Z` tag.
- `--publish`: runs `npm publish` (use after a successful tag/commit).

After tagging, push tags with:

```sh
git push --tags
```

---

## Version Format

Versions follow [semver](https://semver.org/):

- `X.Y.Z` - stable release (e.g., `1.0.0`)
- `X.Y.Z-alpha.N` - alpha pre-release (e.g., `1.0.0-alpha.1`)
- `X.Y.Z-beta.N` - beta pre-release (e.g., `1.0.0-beta.1`)
- `X.Y.Z-rc.N` - release candidate (e.g., `1.0.0-rc.1`)

## Troubleshooting

### "Unable to authenticate" with OIDC
- Verify the workflow filename matches **exactly** what you configured on npmjs.com (including `.yml` extension)
- All fields are **case-sensitive** - `bbopen` ≠ `BBopen`
- Ensure you're using GitHub-hosted runners (not self-hosted)
- Check `id-token: write` permission is set on the publish job

### "npm ERR! 403 Forbidden"
- If using OIDC: verify trusted publisher is configured correctly
- If using token: ensure it has publish permissions and "Bypass 2FA" enabled
- Check the package name isn't taken on npm
- Verify `publishConfig.access` is set to `"public"` in package.json

### "Version mismatch" error in CI
- The git tag version must match `package.json` version exactly
- Run `node scripts/release.mjs <version> --commit --tag` to ensure they match

### Provenance attestation failed
- Ensure the repository has `id-token: write` permission
- The publish must run on GitHub Actions (not locally) for provenance
- With OIDC trusted publishing, provenance is automatic

### Manual publishing with 2FA
If you need to publish manually (not via CI), create a Granular Access Token:
1. Go to npmjs.com → Account → Access Tokens → Generate New Token → Granular Access Token
2. Enable "Bypass two-factor authentication"
3. Set permissions to Read and write
4. Use: `npm config set //registry.npmjs.org/:_authToken=<token>`
