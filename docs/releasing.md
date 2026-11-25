# Prex release channels

Day-to-day work goes to `main`. The binary workflow checks it every three hours and skips publication when the latest Nightly already represents the same commit. Promote a tested Nightly to `prod` with a PR. A push to `prod` builds Stable for Linux and macOS on x64 and ARM64. Each release points to a source SHA and publishes its own checksum files. The separate **Publish Prex** workflow is the manual npm and Linux package path. Bump the npm version before publishing again, and run the OIDC publish from `prod`.

## One-time setup

1. Merge the release workflow to `main`. Keep `main` as GitHub's default branch, since scheduled workflows run on the default branch.
2. Create `prod` from the intended first stable commit after reviewing the changes. Set Vercel's Production Branch to `prod` if `prex.djl.foundation` should follow Stable. Keep the Root Directory at `docs/site` and Output Directory on automatic.
3. For publicly downloadable binaries, either publish the source repository or create a separate, initialized public distribution repository. For the separate repository, set GitHub Actions variable `PREX_DOWNLOAD_REPOSITORY` and the Vercel build environment variable of the same name to its `owner/repo`. Add Actions secret `PREX_DOWNLOAD_TOKEN` with Contents write access to only that distribution repository. The source repo can stay private.
4. Run **Prex binaries** on `main` and `prod` once to seed both channels. Confirm that public downloads work and that `/install` serves the script with the intended repository.
5. The homepage links to the AGPL license in the public repository.

## GitHub branch protection

In **Settings → Rules → Rulesets**, create an active branch ruleset for `main` and one for `prod`. For both, block force pushes and deletions, require a PR and resolved conversations, and require the CI jobs `cli` and `docs` after they have run once so GitHub can resolve their names. Require branches to be up to date before merging. Keep the bypass list limited to the people who need emergency access.

For `main`, set the required review count to match your active maintainers. For `prod`, require one independent approval if a second maintainer is available, dismiss stale approvals, and require approval of the latest reviewable push. Use a regular merge commit for promotions from `main` to `prod` so the two branches retain their shared history. Leave linear history disabled on `prod` when using this promotion flow.

The Vouch, area, and size workflows are triage signals. They should not be required checks. Edit `.github/VOUCHED.td` through a reviewed change on the default branch. An entry does not grant repository access. The attribution workflow posts contributor credit on merged PRs from GitHub author metadata and does not rewrite commits.

## Source references

The scheduled SHA comparison follows [T3 Code's release workflow](https://github.com/pingdotgg/t3code/blob/main/.github/workflows/release.yml). Prex implements PR trust, size and area labels in its own PR triage workflow.
