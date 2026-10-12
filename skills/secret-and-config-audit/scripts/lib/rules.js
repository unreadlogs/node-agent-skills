/**
 * Heuristic secret-detection ruleset.
 *
 * Rules are intentionally conservative: every entry carries a `falsePositives`
 * note because a scanner without known blind spots is worse than no scanner.
 * A finding from this table is a lead to investigate, never proof of a live
 * credential.
 */

/** Matched group index holding the sensitive value; 0 means the whole match. */
export const RULES = [
  {
    id: 'private-key',
    severity: 'high',
    kind: 'private-key',
    summary: 'PEM private key header (RSA, DSA, EC, OPENSSH, PGP, ENCRYPTED).',
    falsePositives: 'Fixture keys committed deliberately for tests; the header alone proves nothing about validity.',
    regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    id: 'certificate',
    severity: 'low',
    kind: 'certificate',
    summary: 'PEM X.509 certificate header. Reported separately because a certificate is public.',
    falsePositives: 'Almost always benign: certificates are meant to be published.',
    regex: /-----BEGIN (?:X509 )?CERTIFICATE-----/g,
  },
  {
    id: 'credential-uri',
    severity: 'high',
    kind: 'credential-uri',
    summary: 'Connection string with inline credentials (postgres, mysql, mongodb+srv, redis, amqp, ftp).',
    falsePositives: 'Localhost or `${VAR}` placeholders; see the placeholder filter.',
    regex: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis(?:s)?|amqps?|ftps?|sftp):\/\/[^\s:/@"']+:[^\s:/@"'<>]{3,}@[^\s/"'<>`]+/g,
  },
  {
    id: 'basic-auth-url',
    severity: 'medium',
    kind: 'credential-uri',
    summary: 'http(s) URL with inline user:password credentials.',
    falsePositives: 'Documentation samples that use obvious placeholder users.',
    regex: /\bhttps?:\/\/[^\s:/@"']+:[^\s:/@"']{3,}@[^\s/"'<>]+/g,
  },
  {
    id: 'github-token',
    severity: 'high',
    kind: 'provider-token',
    summary: 'GitHub token: ghp_/gho_/ghu_/ghs_/ghr_ or github_pat_, 36+ characters.',
    falsePositives: 'Revoked tokens in changelogs; example tokens ending in EXAMPLE.',
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,251}|github_pat_[A-Za-z0-9_]{50,255})\b/g,
  },
  {
    id: 'gitlab-token',
    severity: 'high',
    kind: 'provider-token',
    summary: 'GitLab personal/group/project access token: glpat- followed by 20+ token characters.',
    falsePositives: 'None known; treat as real and rotate if the repository is public.',
    regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'slack-token',
    severity: 'high',
    kind: 'provider-token',
    summary: 'Slack token: xoxb/xoxa/xoxp/xoxr/xoxs followed by 10+ characters.',
    falsePositives: 'Timestamps and ids embedded in xoxe- style workspace tokens.',
    regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: 'slack-webhook',
    severity: 'high',
    kind: 'provider-token',
    summary: 'Incoming Slack webhook URL (hooks.slack.com/services/T.../B.../token).',
    falsePositives: 'Disabling a webhook does not invalidate the URL in git history.',
    regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+/g,
  },
  {
    id: 'stripe-key',
    severity: 'high',
    kind: 'provider-token',
    summary: 'Stripe secret or restricted key: sk_live_/sk_test_/rk_live_/rk_test_ + 10+ characters.',
    falsePositives: 'sk_test_ keys are sandbox-only but still must not be committed.',
    regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
  },
  {
    id: 'anthropic-key',
    severity: 'high',
    kind: 'provider-token',
    summary: 'Anthropic API key: sk-ant- followed by 20+ characters.',
    falsePositives: 'None known.',
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'openai-key',
    severity: 'high',
    kind: 'provider-token',
    summary: 'OpenAI-style API key: sk- (not sk-ant-) followed by 20+ characters.',
    falsePositives: 'Other vendors re-use the `sk-` prefix, so a hit may not be OpenAI.',
    regex: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'google-api-key',
    severity: 'high',
    kind: 'provider-token',
    summary: 'Google API key: AIza + 35 characters.',
    falsePositives: 'Client IDs and OAuth client secrets use a different prefix and are not caught here.',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: 'sendgrid-key',
    severity: 'high',
    kind: 'provider-token',
    summary: 'SendGrid API key: SG. + 16+ characters.',
    falsePositives: 'None known.',
    regex: /\bSG\.[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    id: 'twilio-key',
    severity: 'high',
    kind: 'provider-token',
    summary: 'Twilio account SID or API key SID: SK or AC + 32 hex characters.',
    falsePositives: 'Account SIDs are semi-public identifiers; the paired auth token is the real secret.',
    regex: /\b(?:SK|AC)[0-9a-fA-F]{32}\b/g,
  },
  {
    id: 'npm-token',
    severity: 'high',
    kind: 'provider-token',
    summary: 'npm automation token: npm_ + 36 characters.',
    falsePositives: 'None known.',
    regex: /\bnpm_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: 'pypi-token',
    severity: 'high',
    kind: 'provider-token',
    summary: 'PyPI API token: pypi-AgEIcHlwaS5vcmc + 50+ characters.',
    falsePositives: 'None known.',
    regex: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/g,
  },
  {
    id: 'shopify-token',
    severity: 'high',
    kind: 'provider-token',
    summary: 'Shopify access token: shpat_/shpca_/shppa_/shpss_ + 32 hex characters.',
    falsePositives: 'None known.',
    regex: /\bshp(?:at|ca|pa|ss)_[0-9a-fA-F]{32}\b/g,
  },
  {
    id: 'square-token',
    severity: 'high',
    kind: 'provider-token',
    summary: 'Square access token: sq0atp-/sq0csp- or EAAA + 20+ characters.',
    falsePositives: 'None known.',
    regex: /\b(?:sq0atp-|sq0csp-|EAAA)[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: 'telegram-bot-token',
    severity: 'high',
    kind: 'provider-token',
    summary: 'Telegram bot token: 8-10 digit bot id, colon, 35 characters.',
    falsePositives: 'Timestamps in log lines can mimic the numeric prefix.',
    regex: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
  },
  {
    id: 'aws-access-key',
    severity: 'high',
    kind: 'provider-token',
    summary: 'AWS access key id: AKIA/ASIA/ABIA/ACCA + 16 uppercase alphanumerics.',
    falsePositives: 'Without the matching secret access key the id is useless; ids are also often logged.',
    regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
  },
  {
    id: 'jwt',
    severity: 'medium',
    kind: 'jwt',
    summary: 'JSON Web Token: three base64url segments beginning with eyJ.',
    falsePositives: 'Public/short-lived tokens and test fixtures dominate this class; most JWTs are unsigned or expired.',
    regex: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  },
  {
    id: 'npmrc-token',
    severity: 'medium',
    kind: 'assigned-secret',
    summary: 'npm auth token in .npmrc (_authToken= / //registry:_authToken=).',
    falsePositives: 'Registry entries that point at a local Verdaccio are harmless.',
    regex: /_auth(?:Token)?\s*=\s*\S+/g,
  },
  {
    id: 'assigned-secret',
    severity: 'low',
    kind: 'assigned-secret',
    capture: 1,
    summary:
      'Generic assignment of a secret-sounding key (api_key, secret, token, password, ...) to a 12+ character value.',
    falsePositives:
      'Documentation prose, JSON Schema constraints and non-secret config are the main source of noise; use --min-severity low only when you want them.',
    regex:
      /(?:^|[^\w$.])(?:api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|private[_-]?token|token|password|passwd|passphrase|pwd|credential[s]?)\b["'\s]*[:=]\s*["']?([^\s"',;`)\]}]{12,})/gi,
  },
];

const PLACEHOLDER_PATTERNS = [
  [/^example/i, 'example'],
  [/example$/i, 'example'],
  [/placeholder/i, 'placeholder'],
  [/redacted/i, 'redacted'],
  [/changeme|change-me|change_me/i, 'changeme'],
  [/^(?:your|my|the)-/i, 'pronoun-prefix'],
  [/your[-_ ]?(?:key|token|secret|password|id)/i, 'your-thing-here'],
  [/^xxx/i, 'x-mask'],
  [/^\*+$/, 'star-mask'],
  [/<[^>]*>/, 'angle-mask'],
  [/^\$\{[^}]*\}?$/, 'shell-expansion'],
  [/^\$[A-Za-z_][A-Za-z0-9_]*$/, 'shell-variable'],
  [/^(?:process\.env|import\.meta\.env)\./, 'env-reference'],
  [/^os\.environ/, 'python-env-reference'],
  [/^%[A-Za-z_][A-Za-z0-9_]*%?$/, 'printf-format'],
  [/^(?:dummy|fake|sample|testing|notreal|abcdef|0123456789)$/i, 'dummy-word'],
  [/^\d+$/, 'numeric'],
  [/\b(?:here|blah|foo|bar|foobar|whatever|asdf|qwerty)\b/i, 'prose'],
  [/\b(?:password|passwd|secret|token|apikey|api-key)\b/i, 'prose'],
];

/**
 * Classifies a matched value as documentation rather than a credential.
 * Returns a short reason string, or null when the value looks real.
 */
export function classifyValue(value) {
  if (typeof value !== 'string' || value.length === 0) return 'empty';
  for (const [pattern, reason] of PLACEHOLDER_PATTERNS) {
    if (pattern.test(value)) return reason;
  }
  return null;
}

/**
 * Rules in evaluation order. More specific prefixes are declared first so that
 * `sk-ant-...` is attributed to Anthropic instead of the generic `sk-` rule.
 */
export const ORDERED_RULES = RULES;