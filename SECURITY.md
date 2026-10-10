# Security Policy

## Supported versions

Security fixes land on the latest state of the default branch. This project is early and does not cut release branches or long-term support versions, so the best way to stay covered is to update your checkout.

| Version | Supported |
| ------- | --------- |
| `main`  | Yes       |

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting form instead: **Security → Report a vulnerability** on <https://github.com/unreadlogs/node-agent-skills>.

It helps a great deal if your report says what the issue is and which skill or file it affects, how to reproduce it with a minimal command or input, the impact you believe it has, and anything you already tried. You can expect an acknowledgement within a few days, and if the report is accepted we will agree on a disclosure timeline with you before anything is published.

## Scope and expectations

These skills process files that neither agents nor users fully control, so the boundaries worth protecting are fairly clear.

- **Secret leakage.** `secret-and-config-audit`, `env-doctor`, and the Git tooling must never print a secret value. Redact values in results, errors, and logs.
- **Path traversal and containment.** Archive and file operations must stay inside the paths they were handed.
- **Unbounded resource use.** Anything that touches files, records, pages, or pixels needs an explicit limit and must fail cleanly instead of exhausting memory or time.
- **Command execution.** Prefer Node APIs over shelling out, and never pass a user-supplied string to a shell.

Dependencies keep their own licenses and are maintained upstream. If you find a vulnerability in one, report it to that project as well and let us know here so we can widen the version range.