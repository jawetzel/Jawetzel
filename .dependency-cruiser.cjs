/**
 * Two jobs:
 *  1. Enforce the hexagonal dependency direction (domain ⊳ application ⊳
 *     infrastructure, wired only at composition; client tree never reaches
 *     concrete infrastructure).
 *  2. Surface dead code — modules not reachable from any real entry point
 *     (Next.js app/ special files + root config/boot files).
 *
 * SEEDED from the weekendplant project, adapted to THIS project's `src/` layout:
 * the hexagon lives under `src/domain`, `src/application`, `src/infrastructure`,
 * `src/composition`; routing under `src/app`; the client under `src/features` +
 * `src/components`. Migration is in progress (some slices already in the hexagon),
 * so the direction rules enforce on migrated slices and pass-through where folders
 * don't exist yet. The dead-code rules are `warn` and will scan the flat `src/`
 * tree (expect noise until migration completes; tune as needed).
 *
 * Calibrated to the sanctioned patterns:
 *  - infrastructure MAY import application (ports + *-view projection DTOs) and
 *    domain (entity rehydration) — that is "inward".
 *  - app/ MAY import infrastructure/observability (boundary logging) only.
 */

// Next.js App Router special files (auto-loaded by the framework). Two patterns
// (top-level + nested) instead of one optional group, to stay ReDoS-safe.
const SPECIAL_NAMES =
  "(page|layout|route|loading|error|not-found|template|default|global-error|sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)";
const NEXT_SPECIAL = [
  "^src/app[\\\\/]" + SPECIAL_NAMES + "\\.(ts|tsx|js|jsx)$",
  "^src/app[\\\\/].*[\\\\/]" + SPECIAL_NAMES + "\\.(ts|tsx|js|jsx)$",
];
// Root (or src/) boot files. next.config lives at the repo root; proxy/middleware/
// instrumentation may live at root or under src/.
const ROOT_BOOT =
  "^(src[\\\\/])?(next\\.config|proxy|middleware|instrumentation)\\.[cm]?[jt]s$";
// scripts are run by path (package.json + ad-hoc ops); treat them as roots so
// helpers they use aren't mistaken for dead code.
const SCRIPTS = "^scripts[\\\\/].+\\.[cm]?[jt]sx?$";

// Roots for dead-code reachability: what actually uses the code in anger.
// Tests are deliberately NOT roots — a module only a test reaches is still
// production-dead, which is what we want to see.
const ENTRY_POINTS = [...NEXT_SPECIAL, ROOT_BOOT, SCRIPTS];

// Things that are never "dead" even if unreachable from the entry roots.
const NOT_DEAD = [
  "\\.d\\.ts$", // ambient type declarations
  "\\.css$", // stylesheets
  "\\.fake\\.ts$", // port fakes — used by tests only, by design
  "\\.test\\.(ts|tsx)$",
  "^tests[\\\\/]",
  // the entry points themselves (roots reach themselves; don't self-flag)
  ...NEXT_SPECIAL,
  ROOT_BOOT,
  SCRIPTS,
];

module.exports = {
  forbidden: [
    // ---------- Hexagonal dependency direction ----------
    {
      name: "domain-is-pure",
      comment:
        "src/domain has zero I/O and depends on nothing but itself. (CLAUDE.md: dependency rule)",
      severity: "error",
      from: { path: "^src/domain/" },
      to: {
        path: "^src/(application|infrastructure|composition|app|features|components|lib)/",
      },
    },
    {
      name: "application-no-outward",
      comment:
        "src/application orchestrates over domain + ports only — never infrastructure, composition, app, or the client tree.",
      severity: "error",
      from: { path: "^src/application/" },
      to: { path: "^src/(infrastructure|composition|app|features|components)/" },
    },
    {
      name: "infrastructure-inward-only",
      comment:
        "src/infrastructure adapters depend inward (application + domain) only — never composition, app, or the client tree.",
      severity: "error",
      from: { path: "^src/infrastructure/" },
      to: { path: "^src/(composition|app|features|components)/" },
    },
    {
      name: "only-composition-wires-infrastructure",
      comment:
        "Dependency inversion, stated once: only src/composition wires concrete adapters (src/infrastructure and scripts/ may use their own). Every other layer depends on ports, never concrete infrastructure. Sanctioned exception: src/infrastructure/observability (boundary logging) for server driving adapters.",
      severity: "error",
      from: { pathNot: "^src/(composition|infrastructure)/|^scripts/" },
      to: {
        path: "^src/infrastructure/",
        pathNot: "^src/infrastructure/observability/",
      },
    },
    {
      name: "client-no-infrastructure",
      comment:
        "The client tree never imports concrete infrastructure — not even src/infrastructure/observability (that would drag server-only logging into the client bundle).",
      severity: "error",
      from: { path: "^src/(features|components)/" },
      to: { path: "^src/infrastructure/" },
    },

    // ---------- Hygiene ----------
    {
      name: "no-circular",
      comment: "Circular dependencies make the graph hard to reason about and test.",
      severity: "warn",
      from: {},
      to: { circular: true },
    },

    // ---------- Dead code ----------
    {
      name: "no-orphans",
      comment:
        "Orphan module — nothing imports it and it imports nothing. Almost certainly dead.",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "\\.css$",
          "(^|[\\\\/])\\.[^\\\\/]+\\.[cm]?[jt]sx?$", // dotfiles
          "^(src[\\\\/])?(next\\.config|postcss\\.config|eslint\\.config|vitest\\.config|vitest\\.setup|instrumentation|proxy|middleware)\\.",
          ...NEXT_SPECIAL, // framework entry pages may legitimately import nothing internal
          SCRIPTS,
        ],
      },
      to: {},
    },
    {
      name: "not-reachable-from-app",
      comment:
        "Module is not reachable from any app entry point (Next.js special files or root boot files) — dead production code.",
      severity: "warn",
      from: { path: ENTRY_POINTS },
      to: {
        path: "^src/(domain|application|infrastructure|composition|app|features|components|lib)/",
        pathNot: NOT_DEAD,
        reachable: false,
      },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(node_modules|\\.next|data|coverage|public)/" },
    tsPreCompilationDeps: true, // follow `import type` edges (ports are type-only)
    tsConfig: { fileName: "tsconfig.json" }, // resolve the @/* path alias
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json"],
      mainFields: ["module", "main", "types", "typings"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
