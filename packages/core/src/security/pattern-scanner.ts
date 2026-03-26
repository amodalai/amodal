/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * A match found by the pattern scanner.
 */
export interface PatternMatch {
  pattern: string;
  match: string;
  index: number;
}

/**
 * Luhn check for credit card validation.
 */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CC_PATTERN = /\b(\d[\d\s-]{8,22}\d)\b/g;
const BANK_ACCOUNT_KEYWORD =
  /\b(?:account|routing|acct|aba)\b/i;

/**
 * Regex-based PII pattern detection.
 */
export class PatternScanner {
  scan(text: string): PatternMatch[] {
    const matches: PatternMatch[] = [];

    // SSN
    let m: RegExpExecArray | null;
    const ssnRe = new RegExp(SSN_PATTERN.source, 'g');
    while ((m = ssnRe.exec(text)) !== null) {
      matches.push({pattern: 'ssn', match: m[0], index: m.index});
    }

    // Credit card (13-19 digits with Luhn)
    const ccRe = new RegExp(CC_PATTERN.source, 'g');
    while ((m = ccRe.exec(text)) !== null) {
      const raw = m[0];
      const digits = raw.replace(/[\s-]/g, '');
      if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) {
        matches.push({pattern: 'credit_card', match: raw, index: m.index});
      }
    }

    // Bank account (8-17 digits near keywords)
    const bankRe = /\b(\d{8,17})\b/g;
    while ((m = bankRe.exec(text)) !== null) {
      const start = Math.max(0, m.index - 100);
      const end = Math.min(text.length, m.index + m[0].length + 100);
      const context = text.slice(start, end);
      if (BANK_ACCOUNT_KEYWORD.test(context)) {
        matches.push({
          pattern: 'bank_account',
          match: m[0],
          index: m.index,
        });
      }
    }

    return matches;
  }
}
