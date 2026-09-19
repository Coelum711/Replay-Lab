# Open-source reuse policy

Replay Lab is GPL-3.0-only. Reuse is a feature, not a failure of originality.

## Default choices

- **Dependency first:** use the upstream package when its public API is sufficient. Preferred for editor infrastructure such as TanStack Virtual, Dexie and CodeMirror.
- **Vendor when necessary:** copy source into `third_party/` only for offline packaging, deep modification or when the upstream distribution cannot be consumed directly. Record upstream project, revision and license; preserve copyright/license notices.
- **Port compatible GPL code when useful:** TRPG-Replay-specific GPL-3.0 implementation can be ported or derived directly because Replay Lab itself is GPL-3.0-only. Attribution and source obligations still apply.
- **Treat data/assets separately:** voices, model weights, fonts, icons, mascots, sample projects and media may not share the repository's code license.

## Fast license gate

Normally acceptable for this repository after preserving required notices:

- MIT
- BSD-2-Clause / BSD-3-Clause
- Apache-2.0
- GPL-3.0-compatible code under the project's GPL distribution model

Stop and review before copying:

- AGPL
- LGPL
- MPL
- SSPL / BSL / other source-available licenses
- custom “non-commercial” or research-only terms
- datasets/model licenses and character/voice licenses

## Engineering rule

Before implementing generic infrastructure, search for a mature open-source implementation. If one exists and the license is compatible, prefer integration over a fresh home-grown substitute. Replay Lab should spend custom engineering effort on TRPG semantics, project workflow, compiler behavior and renderer integration rather than generic editor plumbing.
