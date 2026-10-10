---
name: env-doctor
description: >-
  Inspect a Node project for runtime, package-manager, script, and environment
  configuration problems without exposing secret values.
---

# env-doctor

```bash
node scripts/index.js check .
```

The report checks Node version, package metadata, scripts, `.env.example` coverage, and local environment names. Secret values are never returned.
