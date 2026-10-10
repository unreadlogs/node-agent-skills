---
name: ast-aware-js-repo-audit
description: >-
  Run configurable ESLint audits over JavaScript and TypeScript repositories
  and return normalized, location-rich findings without shelling out.
---

# ast-aware-js-repo-audit

This first version uses ESLint's Node API. It reports findings and never edits a repository.

```bash
node scripts/index.js lint src/**/*.js
node scripts/index.js lint . --format json
```

Scope and configuration are explicit. TypeScript projects must provide their own parser and plugins.
