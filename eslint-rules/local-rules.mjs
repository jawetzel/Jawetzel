/**
 * Local ESLint rules — detectors for architecture rules the project already states
 * but nothing could previously check.
 *
 * These exist because `depcruise` enforces dependencies *between* modules and has no
 * opinion about concentration *within* one. A rule that is documented but undetectable
 * is a rule that drifts — a component can reach thousands of lines and a hundred-plus
 * `useState` calls with nothing ever reporting it.
 *
 * Defined as a local flat-config plugin on purpose — no package, no build step, and it
 * rides `npm run lint`, which is wired into `prebuild`. A standalone metrics script
 * would be one more check nobody invokes.
 */

/** Name a function node for the report message. */
function describe(node) {
  if (node.id?.name) return `"${node.id.name}"`;
  const parent = node.parent;
  if (parent?.type === "VariableDeclarator" && parent.id?.name) return `"${parent.id.name}"`;
  if (parent?.type === "Property" && parent.key?.name) return `"${parent.key.name}"`;
  return "This component";
}

/** Is this call `useState(...)` / `React.useState(...)`? */
function isHookCall(node, name) {
  const c = node.callee;
  if (c.type === "Identifier") return c.name === name;
  if (c.type === "MemberExpression" && c.property?.type === "Identifier")
    return c.property.name === name;
  return false;
}

/**
 * Client architecture: local UI state belongs in the owning hook, and the single
 * allowed carve-out for genuinely complex editor state is a *scoped reducer / state
 * machine* — not a pile of independent `useState`.
 *
 * So a component carrying a large pile of `useState` and no `useReducer` is not a
 * borderline style call — it is the carve-out being taken without the thing the
 * carve-out requires. That is mechanically checkable, which "separate your concerns"
 * never is.
 *
 * Counting is per *enclosing function*, so a nested sub-component is judged on its own
 * state rather than inheriting its parent's. This matters: a huge file holding 40
 * ordinary components is a file that needs splitting, while a single function holding
 * 95 `useState` is the actual god-component. A file-level metric points at the wrong
 * target; length is a bad proxy — measure the thing the rule is about.
 */
const stateSprawl = {
  meta: {
    type: "problem",
    docs: { description: "Client state must not sprawl across dozens of useState calls" },
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      sprawl:
        "{{name}} holds {{count}} useState calls (max {{max}}) and no useReducer. " +
        "The client rules allow exactly one carve-out for a genuinely complex " +
        "editor — a scoped reducer / state machine — not a pile of independent useState.",
    },
  },
  create(context) {
    const max = context.options[0]?.max ?? 15;
    const stack = [];

    const enter = (node) => stack.push({ node, states: 0, reducers: 0 });
    const exit = () => {
      const frame = stack.pop();
      if (!frame) return;
      if (frame.states > max && frame.reducers === 0) {
        context.report({
          node: frame.node,
          messageId: "sprawl",
          data: { name: describe(frame.node), count: frame.states, max },
        });
      }
    };

    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,
      CallExpression(node) {
        const frame = stack[stack.length - 1];
        if (!frame) return;
        if (isHookCall(node, "useState")) frame.states++;
        else if (isHookCall(node, "useReducer")) frame.reducers++;
      },
    };
  },
};

/**
 * Ports are named by **role/capability**, not technology.
 *
 * A repository interface with dozens of methods is named by *table*, not capability —
 * every fake must implement all of them, and every consumer takes a dependency on all
 * of them. Counting only call signatures, never plain properties: a data record with
 * 200 fields is fine, an interface with 44 methods is a god-port.
 *
 * Worth checking by hand alongside this: when contract tests are already split by
 * capability but the interface they test is not, the tests have found the seams.
 */
const interfaceSegregation = {
  meta: {
    type: "problem",
    docs: {
      description: "Interfaces should be segregated by capability, not accumulate methods",
    },
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      god:
        "Interface {{name}} declares {{count}} methods (max {{max}}). Ports are named " +
        "by role/capability — split it along the capabilities its consumers actually use.",
    },
  },
  create(context) {
    const max = context.options[0]?.max ?? 15;
    return {
      TSInterfaceDeclaration(node) {
        const methods = node.body.body.filter(
          (m) =>
            m.type === "TSMethodSignature" ||
            (m.type === "TSPropertySignature" &&
              m.typeAnnotation?.typeAnnotation?.type === "TSFunctionType"),
        );
        if (methods.length > max) {
          context.report({
            node: node.id,
            messageId: "god",
            data: { name: node.id.name, count: methods.length, max },
          });
        }
      },
    };
  },
};

const localPlugin = {
  rules: {
    "state-sprawl": stateSprawl,
    "interface-segregation": interfaceSegregation,
  },
};

export default localPlugin;
