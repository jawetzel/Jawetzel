import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
          selector:
            "MemberExpression[object.name='process'][property.name='env']",
          message:
            "src/domain and src/application must not read process.env — read config at the composition boundary and inject it.",
        },
      ],
    },
  },
]);

export default eslintConfig;
