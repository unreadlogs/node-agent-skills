---
name: sqlite-agent-toolkit
description: >-
  Inspect SQLite schemas and run bounded read-only queries with structured
  results for AI agents.
---

# sqlite-agent-toolkit

```bash
node scripts/index.js schema app.db
node scripts/index.js query app.db "SELECT * FROM users LIMIT 20"
```

Queries are read-only by default, limited by row count, and reject multiple statements.
