---
name: git-change-intelligence
description: >-
  Summarize Git changes, changed files, and risk signals through a structured
  Node.js API without exposing arbitrary shell commands.
---

# git-change-intelligence

Report repository status and commits from a controlled working tree.

```bash
node scripts/index.js status .
node scripts/index.js commits . --limit 10
node scripts/index.js diff . --base HEAD~1
```

Results include changed paths and commit metadata. The skill is read-only.
