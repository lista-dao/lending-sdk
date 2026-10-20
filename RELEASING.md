# Releasing

Both packages in this repository are published to npm together, under the
`@lista-dao` scope:

| Package                         | npm                                                |
| ------------------------------- | -------------------------------------------------- |
| `@lista-dao/moolah-sdk-core`    | https://www.npmjs.com/package/@lista-dao/moolah-sdk-core    |
| `@lista-dao/moolah-lending-sdk` | https://www.npmjs.com/package/@lista-dao/moolah-lending-sdk |

Versions are managed with [Changesets](https://github.com/changesets/changesets).
Publishing is performed by the `Release` workflow
(`.github/workflows/release.yml`), which runs on every push to `main`.

A release is three things in order: a changeset describing the change, a
version bump committed to the release branch, and a merge to `main`. The merge
is what publishes.

---

## Prerequisites

**npm access.** Publishing requires an account with write access to both
packages. Current maintainers are listed by:

```bash
npm view @lista-dao/moolah-sdk-core maintainers
```

**`NPM_TOKEN` repository secret.** The workflow authenticates with
`secrets.NPM_TOKEN`. Confirm it exists and when it was last rotated:

```bash
gh secret list --repo lista-dao/lending-sdk
```

npm access tokens expire. Verify the token still authenticates before
starting a release — a token that fails is discovered at the publish step,
after the version bump has already landed on `main`:

```bash
curl -sH "Authorization: Bearer $NPM_TOKEN" https://registry.npmjs.org/-/whoami
```

A valid token returns `{"username":"..."}`. To replace it, create a **Granular
Access Token** (or a classic **Automation** token) on npm with read and write
access to the `@lista-dao` scope, then:

```bash
gh secret set NPM_TOKEN --repo lista-dao/lending-sdk
```

The command prompts for the value, so the token does not enter shell history.

> Classic **Publish** tokens do not work here. When the account has 2FA
> enabled they require a one-time code, which CI cannot supply.

---

## How the workflow authenticates, and what will change

The release job currently publishes with **`secrets.NPM_TOKEN`**.
`changesets/action` decides this for itself, in this order:

1. `NPM_TOKEN` is set in the environment — use it, and stop.
2. Otherwise, if GitHub can mint an OIDC token — use npm trusted publishing.

Because the workflow sets `NPM_TOKEN`, branch 1 always wins and trusted
publishing is never reached. Provenance attestation is unaffected either way:
it comes from `id-token: write`, not from how the registry authenticates.

A trusted publisher **is** configured on npm for both packages but has never
been exercised, so it remains unvalidated.

Two things will eventually force a move off the token:

- **It expires.** Record the expiry when you create it. A token that lapses
  unnoticed costs more than the release it blocks: recovering the npm account
  needed a recovery code and a three-day publishing hold.
- **npm is restricting tokens that bypass 2FA** — account changes since
  August 2026, direct publishing from January 2027. The token in use is of
  that kind, since package publishing access is set to "2FA **or** a granular
  access token with bypass 2fa enabled". Confirm the scope against npm's own
  documentation before relying on this date.

**To switch to trusted publishing**, delete the `NPM_TOKEN` line from the
`changesets/action` env block, leaving `NODE_AUTH_TOKEN`. Branch 2 then
applies. The npm upgrade step must stay: OIDC publishing needs npm 11.5.1 or
newer, and Node 20 ships 10.x. Do this on a release that is actually going
out, so the trusted publisher validates on a real publish.

---

## 1. Write a changeset

On the branch carrying the change:

```bash
pnpm changeset
```

Select the affected packages, choose the bump type, and describe the change.
The description becomes the CHANGELOG entry that consumers read, so write it
for someone upgrading rather than as a commit summary. The result is a
markdown file under `.changeset/`; commit it with the change.

## 2. Apply the version bump on the branch

Before merging, convert the pending changeset into a version bump:

```bash
pnpm changeset version
```

This updates both `package.json` files, writes the CHANGELOG entries, and
deletes the consumed changeset file. Commit all of it.

Review the result before merging. In particular, confirm the bump type is what
you intended — a `major` changeset produces `2.0.0`, a `minor` one produces
`1.1.0`, and the difference is not recoverable once published.

> **This step must happen on the branch, not in CI.**
>
> `changesets/action` supports an alternative flow in which a pending
> changeset reaches `main` and the action opens its own "Version Packages"
> pull request with the bump. That flow cannot run in this repository:
> creating a pull request from a workflow requires the repository to allow
> GitHub Actions to create pull requests, and this repository does not:
>
> ```bash
> gh api repos/lista-dao/lending-sdk/actions/permissions/workflow
> # { "default_workflow_permissions": "read",
> #   "can_approve_pull_request_reviews": false }
> ```
>
> The `permissions:` block in the workflow narrows the token within what the
> repository already allows; it cannot grant a capability the repository
> withholds. If a pending changeset reaches `main`, the action attempts the
> pull-request flow, fails to open it, and the release stalls with the
> changeset unconsumed.

## 3. Merge to `main`

Merging the pull request publishes. The workflow runs two jobs:

**`verify`** — the full gate set, with no publish credential in scope:

```
build · check:types · test · lint · format:check · check:docs
check:packaging · check:consumer · parity:check
```

**`release`** — runs only if `verify` passes. Because step 2 consumed the
changeset, no changesets are pending, so `changesets/action` runs
`changeset publish`. `changeset publish` compares each manifest version
against npm and publishes anything not already there.

The two jobs are separate so that the build toolchain — vitest, rollup, vite
and their dependencies — never executes in the same job that holds a token
able to publish.

## 4. Confirm

```bash
npm view @lista-dao/moolah-sdk-core version
npm view @lista-dao/moolah-lending-sdk version
```

Both should report the new version. Until they do, the release has not
happened, whatever the pull request state suggests.

---

## Verification beyond CI

Three suites exercise the SDK against real chains. They need credentials and
network access that CI does not have, so they are run manually and are not
part of the gate:

| Command            | What it does                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `pnpm fork:flows`  | Executes the vault, market, broker and liquidation flows on a BSC mainnet fork and asserts the resulting state. Needs `BSC_RPC_URL` pointing at an **archive** node — a non-archive endpoint fails partway with an `Archive requests require a personal token` error. |
| `pnpm fork:check`  | Reads live mainnet state through the SDK.                           |
| `pnpm testnet:e2e` | Sends real transactions on BSC Testnet. Needs `BSC_TESTNET_RPC_URL` and `TESTNET_PRIVATE_KEY`, and spends testnet BNB. |

Run `fork:flows` before a significant release. Two known failures are expected
and predate the current work: the Smart Lending single-sided supply step
reverts with `0xd93c0665`, and the liquidation `repaidShares` mode overflows
on a position too far underwater for a proportional seizure. Neither blocks a
release; both should be reproduced against the previous release tag before
being treated as new.

---

## Troubleshooting

**The workflow succeeded but npm shows the old version.**
`changeset publish` skips any version already on npm. If the manifests still
carry the previously published version, step 2 was missed — the changeset
reached `main` unconsumed. Apply `pnpm changeset version` on a branch and
merge it.

**The publish step fails with `401` or `403`.**
The token has expired or lacks write access to the scope. Replace it as
described under Prerequisites. The version bump is already on `main` at this
point; re-running the workflow after fixing the token publishes without any
further change.

**The publish step fails with `EOTP`.**
The token requires a one-time password, which means it is a classic Publish
token. Replace it with a Granular Access Token or a classic Automation token.

**A package published but the other did not.**
`changeset publish` handles each package independently. Re-running the
workflow publishes the remaining one; the already-published package is
skipped.

**The publish step fails with `TLOG_CREATE_ENTRY_ERROR` and a 409.**

```
npm error code TLOG_CREATE_ENTRY_ERROR
npm error error creating tlog entry - (409) an equivalent entry already
exists in the transparency log
```

Publishing with provenance signs a statement and records it in Sigstore's
public transparency log. The statement covers the source commit and the
workflow run, and the log rejects a byte-identical entry. An earlier attempt
that failed *after* signing has therefore already claimed that entry, and
every retry from the same commit reproduces it.

Retrying the same run cannot clear this. Land any new commit on `main`
instead: the provenance then references a different commit, which is a
different statement and a new log entry. `changeset publish` skips whatever
already reached npm, so only the outstanding package is published.

**The registry still reports the old version right after a successful run.**
npm's registry is eventually consistent, and `npm view` caches on top of that.
Query the registry directly before concluding a publish did not land:

```bash
curl -s https://registry.npmjs.org/@lista-dao%2Fmoolah-sdk-core \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['dist-tags'])"
```
