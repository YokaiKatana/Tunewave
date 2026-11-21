# Code signing policy

Tunewave's Windows release binaries are built from the public
[`YokaiKatana/Tunewave`](https://github.com/YokaiKatana/Tunewave) repository by
GitHub Actions, from tagged source.

Tunewave is applying to the [SignPath Foundation](https://signpath.org/)
open-source program for free code signing. Once approved, Windows release
binaries will be signed as part of the automated release build.

> Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## Team and roles

Tunewave is maintained by a single developer. The same person holds every role:

- **Authors** (may change source code): [@YokaiKatana](https://github.com/YokaiKatana)
- **Reviewers** (review changes from non-committers): [@YokaiKatana](https://github.com/YokaiKatana)
- **Approvers** (approve each signing request): [@YokaiKatana](https://github.com/YokaiKatana)

All team members use multi-factor authentication for both GitHub and SignPath.

## How releases are built and signed

1. A release is published by pushing a version tag / bumping the version in `package.json`.
2. GitHub Actions builds the app from source (`.github/workflows/build.yml`), with no manual steps that alter the binaries.
3. The build artifact is submitted to SignPath for signing.
4. Signing is approved manually for every release.
5. The signed artifact is attached to the corresponding GitHub Release.

Binaries are built from source in a verifiable way, and the product name and
version metadata are set on every signed binary.

## Privacy

See [PRIVACY.md](PRIVACY.md). In short: Tunewave has no servers, no account
system and no telemetry. It transfers information to another networked system
only when the user asks it to — namely to Google / YouTube, which is required to
sign in and play music — and the user's login is stored only on their own
computer.
