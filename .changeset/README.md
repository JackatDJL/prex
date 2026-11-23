# Releases

1. Run `npm run changeset` for changes that affect the npm package. Choose the semver bump and describe the user-visible change.
2. Run `npm run version:packages` to consume pending changesets and update the version, changelog, and npm lockfile. Commit the results.
3. Run `npm test` and `npm run release` with npm publish access. Changesets publishes the package and creates the release tag. Push the tag to GitHub after verifying the version in npm.

The first release is already versioned at 0.1.0. Publish that version without a version bump.

## Trusted Publishing

On npm, open the package settings and add a GitHub Actions trusted publisher for **JackatDJL / prex**, workflow filename **publish.yml**, with **Allow npm publish** enabled. Leave the environment field blank. The workflow file lives at `.github/workflows/publish.yml`. For an unregistered package, publish 0.1.0 once to create it before opening the package settings.

After creating the trust relationship, run **Publish Prex** from `main` with `publish_npm` enabled. npm requires the first successful OIDC publish within two days of creating the relationship, so set it up when the next unpublished version is ready. The GitHub workflow uses OIDC and has no npm token secret. Changesets determines the version and changelog before the workflow runs. GitHub-hosted Linux runners build and test the release before the publish job.
