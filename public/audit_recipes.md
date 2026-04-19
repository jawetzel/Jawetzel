# Recipe Audit Workflow

## Purpose

Audit old recipes for content quality issues — bad formatting, missing fields,
instructions packed into a single string, etc. Each audited recipe gets flagged
with `audited_01: true` so it isn't reviewed again.

## Do NOT Change (legacy fields — leave as-is)

- **title** — leave as-is, even if bloated or clickbaity
- **slug** — never change (URLs depend on it)
- **ingredients** — legacy string array, kept for input purposes
- **servings** — legacy string, replaced by `min_servings`/`max_servings`
- **ingredientTerms** — legacy, replaced by `canonical_name` in `ingredient_list`
- **nutritionText** — legacy string, replaced by `nutrition_facts`
- **macros** — legacy object, replaced by `nutrition_facts`

## Common Issues to Fix

| Problem | Example | Fix |
|---------|---------|-----|
| Instructions in one blob | `"a. Do X b. Do Y"` | Split into separate array elements |
| Wrong difficulty casing | `"easy"`, `"medium"`, `"hard"` | Use `"Easy"`, `"Intermediate"`, `"Advanced"` |
| Missing `times` | `null` | Add `{ "prepTime": "30 minutes", "cookTime": "20 minutes", "totalTime": "50 minutes" }` |
| Wrong time field names | `{ "prep": "5 min" }` | Use `prepTime`, `cookTime`, `totalTime` with human-readable values |
| Empty `ingredientTerms` | `[]` | Do NOT audit — legacy, derived from `ingredient_list` |
| Empty `diets` | `[]` | Add applicable diets if obvious |
| Vague servings | `"2"` when clearly feeds more | Set `min_servings` / `max_servings` to realistic numbers |
| Ingredient/instruction mismatch | Ingredient used in instructions but missing | Add to `ingredient_list` |
| Stale nutrition | Doesn't match ingredients or serving count | Recalculate `nutrition_facts` from **fixed** `ingredient_list` ÷ **fixed** servings |

## File Structure

```
data/audit_01/
├── audit_recipes.md                  # this file
├── new_terms.json                    # taxonomy terms not on the approved list (needs review)
├── batches/
│   └── batch_NNNN.json              # pre-split arrays of 5 IDs (deleted after processing)
├── source/
│   └── {id}.json                     # pre-dumped recipe data (read-only, audit fields only)
└── recipes/
    └── {id}.json                     # only created when changes are needed
```

### new_terms.json

When a recipe needs a cuisine, course, or diet not on the approved list, the term
is added here with the recipe ID so it can be traced back if rejected.

```json
{
  "cuisines": [
    { "term": "example-cuisine", "recipeId": "69a213ba..." }
  ],
  "courses": [],
  "diets": []
}
```

If a term is approved, add it to `scripts/seed-taxonomies.ts` and this doc's
Valid Options section. If rejected, remove the term from the recipe's `recipes/{id}.json`.

## Scripts

### Pull the next batch of unaudited recipes

```bash
npm run audit:pull
```

Pulls the next 5 unaudited recipes in one DB call (only audit-relevant fields),
prints them as a JSON array, and marks all as `audited: true` in the source file.

Pull a different batch size:

```bash
npm run audit:pull -- --count 10
```

Pull a specific recipe by ID:

```bash
npm run audit:pull -- --id 69a213ba0290052ed8970b03
```

### Apply all fixes to the database

```bash
npm run audit:update               # apply all
npm run audit:update -- --dry-run  # preview without writing
```

Scans all IDs from the source JSON:
- Has `recipes/{id}.json` → apply fixes + set `audited_01: true`
- No file → just set `audited_01: true`

## Claude-Assisted Audit Loop

### Setup (once)
1. Export recipe IDs to `cookjunkie.recipes.json`
2. Run `npm run audit:dump` to pre-dump all recipes to `source/{id}.json`

### Per session (parent → 50 parallel workers)

1. Read this doc, then glob `batches/batch_*.json` and read the first **1** batch file (10 IDs)
2. Spawn ALL 10 Agent workers in a **single message** — emit all 10 Agent() tool calls in one response so they run in parallel. Each agent prompt includes the audit rules inline:

```
Agent({
  model: "opus",
  prompt: "Audit this recipe. Read source, analyze, write fix file.
    Source: data/audit_01/source/{id}.json
    Output: data/audit_01/recipes/{id}.json
    {inline the audit rules from the Field Reference, Do NOT Change, Structured Ingredients, and new_terms sections}"
})
```

3. After all 10 agents complete, delete the batch file. Do NOT collect or summarize individual results — the fix files on disk are the output. Just confirm "50 workers done, batch_NNNN deleted."

**IMPORTANT**:
- All 10 Agent() calls MUST be in a single message (one response, 10 tool uses)
- Inline the audit rules in each agent prompt — workers need exactly 2 tool calls: 1 read → 1 write
- The parent reads this doc once, spawns once, deletes once. **3 turns total, no more.**
- Do NOT read worker results or build summaries

### Migration
- When ready, run `npm run audit:update` to push all fixes to DB
- Resume anytime — progress tracked via `audited` field in source JSON

## Field Reference (what to audit)

- **description**: 1-2 sentences describing the dish, no emojis or clickbait
- **instructions**: Array of strings, one step per element
- **difficulty**: `"Easy"` | `"Intermediate"` | `"Advanced"`
- **times**: `{ "prepTime": "30 minutes", "cookTime": "20 minutes", "totalTime": "50 minutes" }`
- **cuisines**: Must use valid options below
- **courses**: Must use valid options below
- **diets**: Must use valid options below
- **min_servings**: number — minimum servings
- **max_servings**: number — maximum servings (same as min if fixed)
- **ingredient_list**: Structured ingredient objects (see below)
- **nutrition_facts**: `{ "calories": N, "protein": N, "carbs": N, "fat": N, "fiber": N, "sugar": N, "sodium": N }` (per serving)
- **background**: Brief cultural/historical context (optional)
- **notes**: Serving suggestions or tips (optional)
- **platingTips**: Plating and presentation tips (optional)

**Nutrition rule**: Calculate `nutrition_facts` from the **final** `ingredient_list` ÷
midpoint of `min_servings`/`max_servings`.

## Valid Options

See `ref_taxonomies.json` for all valid values for difficulty, cuisines, courses, diets, and units.
Only read it if you encounter a value you're unsure about — do NOT read it every session.

## Structured Ingredients (`ingredient_list`)

Each ingredient is an object:

```json
{
  "quantity": 3,
  "unit": "tbsp",
  "name": "tomato, diced",
  "canonical_name": "tomato",
  "substitutions": ["red bell pepper", "tomatillo"]
}
```

- **quantity**: number or `null` (for "to taste", "pinch", etc.)
- **unit**: imperial measurement unit (see valid units below), empty `""` if none (e.g. `"2 eggs"`)
- **name**: full ingredient text including prep (`"egg, at room temperature"`, `"butter, softened"`)
- **canonical_name**: the base ingredient (`"pineapple"`, `"egg"`, `"butter"`) — replaces `ingredientTerms` for search and pantry matching
- **substitutions**: different ingredients that can fill the same role — not
  different forms of the same ingredient. Empty `[]` if none obvious

Always use imperial units (see `ref_taxonomies.json` for valid units). Convert metric sources during audit.
