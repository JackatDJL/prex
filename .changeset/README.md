# Releases

1. Run `npm run changeset` for changes that affect the npm package. Choose the semver bump and describe the user-visible change.
2. Run `npm run version:packages` to consume pending changesets and update the version, changelog, and npm lockfile. Commit and push the results to `main`.
3. Run `npm test`, then start **Publish Prex** from `main` with `publish_npm` enabled. The Linux job builds and tests the release before the npm job publishes it through OIDC.
4. After the registry confirms the version, create and push its `v<version>` Git tag. The GitHub workflow publishes the package but does not create a tag.

The first release is already versioned at 0.1.0. Publish that version without a version bump.

## Trusted Publishing

The initial 0.1.0 publish uses npm's passkey flow to create the package:

```sh
npm login --auth-type=web
npm whoami
npm publish ./jkxrx-prex-0.1.0.tgz --access public
npm view @jkxrx/prex@0.1.0 version
```

If npm challenges the publish, complete its security-key prompt in the browser; a TOTP is not required. Then open the package settings and add a GitHub Actions trusted publisher for **JackatDJL / prex**, workflow filename **publish.yml**, with **Allow npm publish** enabled. Leave the environment field blank. The workflow file lives at `.github/workflows/publish.yml`.

Do not rerun the npm job while `package.json` still says `0.1.0`; npm rejects a version that is already published. Configure trusted publishing when the next real Changesets release is ready, then complete its first successful OIDC publish within two days. The GitHub workflow uses OIDC and has no npm token secret. npm does not generate provenance attestations for packages published from this private GitHub repository, even with OIDC.
