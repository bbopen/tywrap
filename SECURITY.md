# Security Policy

## Bridge trust model

The tywrap Python bridge imports whatever modules its caller names, then reads
and calls attributes on them. None of this is sandboxed, so treat every module
and attribute exposed through the bridge as trusted code.

Use these environment variables to bound that surface:

- `TYWRAP_ALLOWED_MODULES` is an import allowlist. Set it to a non-empty, comma-
  and/or whitespace-separated list of allowed module names to limit imports to
  those modules (plus standard-library modules the bridge needs).
- Underscore-prefixed attributes are blocked by default. Set
  `TYWRAP_ALLOW_PRIVATE_ATTRS=1` only to opt out for trusted code.

tywrap includes no HTTP server or server-side HTTP transport. `HttpBridge`
only connects to a server that you run and secure.

## Network exposure

If you expose a bridge over a network, configure a non-empty
`TYWRAP_ALLOWED_MODULES` allowlist and provide your own authentication. The
local subprocess bridge's default allow-all import behavior is intended only for
trusted, same-user use.

## Supported versions

| Version            | Security fixes |
| ------------------ | -------------- |
| Latest 0.x minor   | Yes            |
| Earlier 0.x minors | No             |

## Reporting a vulnerability

Please use
[GitHub private vulnerability reporting](https://github.com/bbopen/tywrap/security/advisories/new):
open the repository's **Security** tab and choose **Report a vulnerability**.
