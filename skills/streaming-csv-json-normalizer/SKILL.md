---
name: streaming-csv-json-normalizer
description: >-
  Parse, inspect, normalize, and export CSV data with explicit columns and
  machine-readable row errors using Node.js streams.
---

# streaming-csv-json-normalizer

This skill handles the boring but important boundary between human CSV files and structured agent data. Values remain strings unless a caller explicitly requests casts.

```bash
node scripts/index.js inspect data.csv
node scripts/index.js parse data.csv --output data.json
node scripts/index.js stringify data.json output.csv --columns name,email
```
