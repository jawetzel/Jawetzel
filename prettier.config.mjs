/**
 * Prettier — the formatter. Formatting is deliberately NOT an ESLint concern:
 * ESLint fixes violations in place, Prettier reprints the file from the parse tree,
 * and only the latter can lay out a 10,000-character line. `eslint-config-prettier`
 * is appended last in `eslint.config.mjs` so the two never disagree.
 *
 * Near-default on purpose. The value of Prettier is that nobody argues about it;
 * every knob turned here is a knob a contributor has to learn.
 *
 * Do NOT add a `max-len` rule on top of this. `printWidth` is a target, not a
 * ceiling — Prettier exceeds it whenever nothing can be broken (long string
 * literals, URLs, a Tailwind class list), and `max-len` has no autofixer, so it
 * reports a long line and leaves it there. The enforceable invariant is "the file
 * is formatted" (`prettier --check`), which is strictly stronger and whose every
 * failure is fixable with one command.
 */

/** @type {import("prettier").Config} */
const config = {
  // 80 is cramped for JSX carrying Tailwind class lists; 120 stops being scannable
  // in a split editor pane.
  printWidth: 100,

  // Markdown prose is left exactly as written — reflowing paragraphs produces large
  // diffs with no review benefit, and `docs/` is prose, not code.
  proseWrap: "preserve",

  // NOTE: this repo is currently CRLF throughout (`core.autocrlf=true`, no
  // `.gitattributes`). "lf" is the TARGET, not the present state — until the tree is
  // renormalised, `format:check` reports every file in the repo as unformatted on
  // line endings alone. That is why `format:check` is deliberately NOT in `prebuild`
  // yet: a gate that fails on hundreds of false positives trains people to ignore it.
  //
  // To turn it on, in this order:
  //   1. Add `.gitattributes` (`* text=auto eol=lf`) AND run `git add --renormalize .`
  //      AND run `npm run format` — all in ONE commit. Splitting them gives you two or
  //      three repo-wide whitespace diffs instead of one.
  //   2. Put that commit's SHA in `.git-blame-ignore-revs` and set
  //      `git config blame.ignoreRevsFile .git-blame-ignore-revs`, or the reformat
  //      destroys `git blame`. Decide this BEFORE the commit exists.
  //   3. Only then add `npm run format:check` to the `prebuild` chain.
  endOfLine: "lf",
};

export default config;
