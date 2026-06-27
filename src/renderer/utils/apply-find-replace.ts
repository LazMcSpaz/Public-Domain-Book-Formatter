/**
 * applyFindReplace — apply a book's saved find-replace rules to the markdown
 * intermediate (SPEC §4 per-book find-replace dictionary). Pure: no React, no
 * mutation of the inputs.
 *
 * Rules are applied in order, each over the result of the previous one. Literal
 * rules replace every occurrence; `regex: true` rules compile `new RegExp(find,
 * 'g')`. Invalid regexes (or empty `find`) are skipped rather than throwing, so
 * a single bad rule never aborts the whole pass.
 */
import type { FindReplaceRule } from '@core/model'

/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function applyFindReplace(markdown: string, rules: FindReplaceRule[]): string {
  let out = markdown
  for (const rule of rules) {
    // An empty `find` would either no-op (literal) or match everywhere (regex);
    // skip it to keep behaviour predictable.
    if (rule.find === '') continue

    if (rule.regex) {
      let re: RegExp
      try {
        re = new RegExp(rule.find, 'g')
      } catch {
        // Invalid pattern — ignore this rule entirely.
        continue
      }
      out = out.replace(re, rule.replace)
    } else {
      const re = new RegExp(escapeRegExp(rule.find), 'g')
      // For literal rules, keep the replacement literal too: `$` is special in
      // String.prototype.replace replacements, so escape it to `$$`.
      out = out.replace(re, rule.replace.replace(/\$/g, '$$$$'))
    }
  }
  return out
}
