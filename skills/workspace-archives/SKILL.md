---
name: workspace-archives
description: >-
  Create and inspect bounded ZIP workspace archives with manifests, path
  containment checks, and no system archive commands.
---

# workspace-archives

Package selected local files for agent handoff. Archive creation is allowlist-based and excludes directories such as `.git` and `node_modules` by default.

```bash
node scripts/index.js pack report.md evidence.json handoff.zip
node scripts/index.js list handoff.zip
```

This first version creates and lists ZIP files. It does not extract untrusted archives, encrypt archives, or scan files for malware.
