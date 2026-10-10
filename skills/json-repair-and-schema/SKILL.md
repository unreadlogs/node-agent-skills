---
name: json-repair-and-schema
description: >-
  Validate, repair, and schema-check JSON and JSONL with explicit diagnostics.
---

# json-repair-and-schema

Use this skill at the boundary between agent output and reliable machine data.

```bash
node scripts/index.js validate response.json schema.json
node scripts/index.js repair broken.json fixed.json
node scripts/index.js jsonl events.jsonl --schema event.schema.json
```

Repair is conservative and always reports that the input changed. Schema validation is performed with Ajv.
