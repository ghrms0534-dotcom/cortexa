const riskyPatterns = [
  /\bdel\b/i,
  /\berase\b/i,
  /\brmdir\b/i,
  /\bRemove-Item\b/i,
  /\bgit\s+push\b/i,
  /\bscp\b/i,
  /\bcurl\b/i,
  /\bInvoke-WebRequest\b/i,
  /\bmail\b/i,
  /\bsend-mailmessage\b/i
];

export function detectRisk(command: string): string | null {
  for (const pattern of riskyPatterns) {
    if (pattern.test(command)) {
      return `Command matches risky pattern: ${pattern}`;
    }
  }

  return null;
}
