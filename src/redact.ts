// Redact secrets from prompt text before it is stored in git notes.
// Conservative by design: better to mask a false positive than leak a key.

const PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk|rk|pk)_(live|test|prod)_[A-Za-z0-9]{8,}\b/g, '[REDACTED_KEY]'], // stripe/razorpay style
  [/\brzp_(live|test)_[A-Za-z0-9]{8,}\b/g, '[REDACTED_KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED_GOOGLE_KEY]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_API_KEY]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'"]+:[^\s'"@]+@/gi, '$1://[REDACTED]@'],
  [/\b([A-Z][A-Z0-9_]{2,}(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD))\s*[=:]\s*['"]?[^\s'"]{6,}/g, '$1=[REDACTED]'],
];

export function redact(text: string, extra: RegExp[] = []): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  for (const re of extra) out = out.replace(re, '[REDACTED]');
  return out;
}
