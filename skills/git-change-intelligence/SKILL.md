---
name: git-change-intelligence
description: >-
  Return structured Git working-tree status, recent commit metadata, and changed
  paths using a read-only JavaScript Git implementation. Use when an agent
  needs a quick repository-change inventory or history sample. This tool does
  not return patch hunks, stage files, or create commits.
---

# Git change intelligence

Use for a compact inventory before reviewing a change or when a caller needs
machine-readable status/history. It reads the repository and emits one JSON
object to stdout; errors go to stderr as JSON with exit code 1.

```sh
node scripts/index.js status .
node scripts/index.js diff .
node scripts/index.js commits . --limit 8
```

Run it against the repository root. It uses `isomorphic-git` and does not call
the system `git` executable. Repositories that depend on Git features not
supported by that library may produce incomplete results or an error; use the
project's Git tooling for authoritative patch review.

## Commands

`status <repo>` returns the status matrix for tracked and untracked files.
Each entry includes the path, numeric HEAD/worktree/stage status values from
isomorphic-git, and a simplified state (`untracked`, `deleted`, `staged`,
`modified`, or `clean`). Paths are relative to the repository.

`diff <repo>` filters that same status inventory to paths whose simplified
state is not `clean`. It is a changed-path summary, not a textual diff: it has
no patch hunks, rename detection, or whitespace analysis. Inspect actual diffs
with Git when reviewing line-level changes.

`commits <repo> [--limit N]` returns newest-first commit objects with object
ID, message, author, and committer metadata. The limit defaults to 10, must be
a positive integer, and is capped at 100. It does not include file-level
commit stats or guarantee the complete history.

Example response:

```json
{"data":{"repo":"/workspace/project","files":[{"file":"src/app.js","head":1,"worktree":2,"stage":1,"state":"modified"}]}}
```

## Review workflow

1. Run `status` to see whether the tree is clean and note staged versus
   unstaged work before editing.
2. Use `diff` for the changed-path list, then inspect the relevant patch with
   the repository's normal Git interface.
3. Use `commits` as orientation only; check commit details directly when the
   exact patch or parent relationship matters.
4. Preserve all existing user changes. This utility is read-only; do not
   interpret a clean report as proof that generated, ignored, or untracked
   material outside its view does not exist.
