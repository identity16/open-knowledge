# Change notes

Every pull request that changes what a user sees or does adds one file here. The release step (`pnpm changelog:release <version>`) gathers them into a `## <version> (<date>)` section at the top of [`CHANGELOG.md`](../CHANGELOG.md), deletes them, and that section becomes the GitHub Release body and the docs changelog entry.

Name the file after the change, for example `notion-comments.md`:

```md
---
type: feature
---
Linked documents show the Notion page's open comments in the Comments tab, and you can reply from OpenKnowledge.
```

- `type` is `feature` (something new), `fix` (something broken now works) or `change` (existing behaviour is different).
- Write one to three sentences for the person using OpenKnowledge: what they can do now or what stopped going wrong. Leave out file names, internal names and how it was built.
- Skip the note for changes nobody using the product would notice: refactors, tests, CI, internal tooling.
- One file per change. A pull request with two unrelated user-facing changes adds two files.
