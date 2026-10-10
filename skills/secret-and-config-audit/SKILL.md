---
name: secret-and-config-audit
description: >-
  Scan a repository for likely secrets and risky configuration while redacting
  values from every result.
---

# secret-and-config-audit

```bash
node scripts/index.js scan .
```

This is a heuristic scanner. It reports file, line, type, and redacted evidence. It does not prove that a value is a live credential and never prints the original value.
