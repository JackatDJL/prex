# Releases

1. Run `npm run changeset` for changes that affect the npm package. Choose the semver bump and describe the user-visible change.
2. Run `npm run version:packages` to consume pending changesets and update the version, changelog, and npm lockfile. Commit the results.
3. Run `npm test` and `npm run release` with npm publish access. Changesets publishes the package and creates the release tag. Push the tag to GitHub after verifying the version in npm.

The first release is already versioned at 0.1.0. Publish that version without a version bump.
