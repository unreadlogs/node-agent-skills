---
name: workspace-archives
description: >-
  Package a deliberate set of local files into a ZIP for agent handoff or list
  the entries of a ZIP. Use when selected evidence or project files need to be
  bundled for transfer. The tool does not extract archives, include directories,
  encrypt data, or inspect file contents for secrets or malware.
---

# Workspace archives

This CLI creates ZIP files from explicit file paths and lists ZIP entry names
and compressed sizes. It emits one JSON object to stdout; failures use JSON on
stderr and exit code 1.

```sh
node scripts/index.js pack README.md reports/summary.json /tmp/handoff.zip
node scripts/index.js list /tmp/handoff.zip
```

## Pack selected files

Syntax: `pack <file...> <output.zip>`. Provide one or more existing regular
files followed by the output path. The archive stores each entry under its
basename. Because two different source files with the same basename would
overwrite each other inside the ZIP, the command rejects such collisions.
Inputs under a path segment named `.git` or `node_modules` are excluded. The
archive is compressed and written to the requested path; do not choose an
output path that contains private material you do not intend to share.

The command accepts at most 1000 inputs. It does not traverse directories or
silently add dependencies, hidden files, or neighboring files. Build an
explicit allowlist and inspect it before packing. The file list is not content
aware: a selected file can still contain credentials or personal data.

Example response:

```json
{"data":{"output":"/tmp/handoff.zip","files":2,"size":1840}}
```

## List and verify

Syntax: `list <archive.zip>`. It reads the ZIP central directory and returns
entry names plus compressed byte sizes. The listing operation does not extract
files or validate their decompressed contents. Archives larger than 100 MiB
and ZIP64 archives are not supported by the listing command.

```json
{"data":{"input":"/tmp/handoff.zip","files":[{"name":"README.md","compressedSize":720}]}}
```

After packing, list the archive and compare the returned entry names with the
allowlist. If recipients need directory structure, this version's basename
layout is not suitable; package with a tool that preserves an explicitly
reviewed relative path map.

## Operational boundaries

- No extraction command exists, so this tool cannot overwrite files from an
  untrusted archive.
- It does not encrypt, sign, scan, or redact. Treat the ZIP as sensitive as
  its most sensitive input.
- It does not call system archive utilities. A malformed ZIP may be rejected
  during listing; a successful listing proves entry metadata was readable,
  not that each compressed stream is healthy.
