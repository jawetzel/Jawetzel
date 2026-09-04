import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import local from "./eslint-rules/local-rules.mjs";

/**
 * Severity here tracks *architectural blast radius*, not uniform strictness.
 * A rule is `error` in the layer where violating it corrupts an invariant, and
 * `warn` in leaf UI where it is debt to burn down.
 *
 * Note this config is now wired into `prebuild` via `npm run lint`. Before that it
 * was a script nobody called: `next build` stopped running ESLint itself in Next 15,
 * so this project silently lost lint enforcement on upgrade and was never told.
 */
const SERVER_CORE = [
  "src/domain/**",
  "src/application/**",
  "src/infrastructure/**",
  "src/composition/**",
  "src/worker/**",
];
const CLIENT = ["src/app/**", "src/components/**", "src/lib/**", "src/content/**", "src/data/**"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // The pure core (src/domain + src/application) must never read process.env. Config is read
  // ONCE at the composition boundary and injected as plain values, so use-cases stay
  // deterministic and their unit tests are env-free (no ambient NODE_ENV / .env dependency).
  // depcruise enforces the import-direction half of the hexagon; this enforces env access,
  // which an import-graph tool cannot see. (Seeded from weekendplant; targets this project's
  // src/ layout.) See CLAUDE.md › "use-case never reads process.env".
  {
    files: ["src/domain/**/*.{ts,tsx}", "src/application/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            "src/domain and src/application must not read process.env — read config at the composition boundary and inject it.",
        },
      ],
    },
  },

  // The `files` glob here is not cosmetic and must not be widened. In flat config a
  // plugin's rules are only resolvable for files the plugin was registered against, and
  // `eslint-config-next` registers `react` for exactly this set — note it excludes
  // `.cjs`. An unscoped override reaches `.dependency-cruiser.cjs`, where `react` was
  // never loaded, and ESLint hard-errors on startup rather than skipping the rule.
  // (`@typescript-eslint` is registered with no `files`, so its rules are safe anywhere.)
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      // The default also forbids `'` and `"`, which in any content-heavy app means a
      // flood of reports on prose reading `don't` and `"handmade"` — none of them
      // defects. `>` and `}` are the genuinely ambiguous characters; keep only those.
      "react/no-unescaped-entities": ["error", { forbid: [">", "}"] }],
    },
  },

  {
    rules: {
      // Dead code is the same problem depcruise already flags as `no-orphans`.
      // `_`-prefixed args stay exempt — that is the deliberate "unused on purpose" signal,
      // which the default rule config cannot see.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },

  // Server core: `any` here punches a hole in an invariant the domain is supposed to
  // guarantee. This is where the type system is load-bearing, so it blocks.
  {
    files: SERVER_CORE,
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },

  // Client tree: same rule, real debt, but a bad cast renders wrong rather than
  // corrupting persisted state. Warn and burn down.
  {
    files: CLIENT,
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  },

  // Node maintenance scripts are plain CommonJS. `require()` is correct there; the rule
  // is right for the app and simply was never scoped away from this folder.
  {
    files: ["scripts/**/*.js"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },

  // A throwaway cast in a fake or a fixture is not type debt.
  {
    files: ["tests/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },

  // Decomposition detectors. `depcruise` polices dependencies *between* modules and has
  // no opinion about concentration *within* one — which is how a multi-thousand-line
  // component accumulates unreported.
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { local },
    rules: {
      // These two assert something falsifiable, so they block.
      "local/state-sprawl": ["error", { max: 15 }],
      "local/interface-segregation": ["error", { max: 15 }],

      // Size is a smoke alarm, not the rule. "Decompose on seams, not size" means a
      // length cap cannot be the gate, and over-decomposition is its own failure — so
      // length prompts a seam review, it never fails a build. It also has known false
      // positives on legitimately long data and schema files.
      "max-lines": ["warn", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 150, skipBlankLines: true, skipComments: true }],
      complexity: ["warn", { max: 20 }],
      "max-depth": ["warn", 4],
    },
  },

  // Test files legitimately run long and declare local shapes.
  {
    files: ["tests/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: { "max-lines": "off", "max-lines-per-function": "off" },
  },

  // Must stay last: disables every stylistic rule that would fight the formatter.
  // Formatting is Prettier's job; ESLint's job is finding defects.
  prettier,
]);

export default eslintConfig;
