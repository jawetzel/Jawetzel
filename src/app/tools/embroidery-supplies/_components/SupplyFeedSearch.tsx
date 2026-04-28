"use client";

import { Search, ExternalLink, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { SUPPLY_DEFAULT_TOLERANCE } from "@/lib/ai/embroidery-supplies/constants";

type Shop = { name: string; product_count: number };

type Listing = {
  price: number | null;
  cost: number | null;
  qty: number | null;
  url: string | null;
};

type Candidate = {
  product_key: string;
  brand: string;             // manufacturer ("Madeira", "Fil-Tec", "Isacord", ...)
  product_line: string;      // line within brand ("Polyneon 40", "Glide 40wt", ...)
  color_number: string;
  color_name: string | null;
  hex: string | null;
  length_yds: number;
  thread_weight: number | null;
  material: string;
  listings: Record<string, Listing>;  // keyed by shopping_source
};

type ColorMatch = Candidate & {
  distance: number;
  length_delta: number | null;
};

type NeighborhoodEntry = {
  hex: string;
  distance_from_reference: number;
};

type Neighborhood = {
  reference_hex: string;
  tolerance: number;
  left: NeighborhoodEntry[];
  right: NeighborhoodEntry[];
};

type ViewState =
  | { kind: "searching" }
  | { kind: "candidates"; results: Candidate[] }
  | {
      kind: "matches";
      anchor: Candidate | null;
      referenceHex: string;
      matches: ColorMatch[];
      total: number;
      tolerance: number;
      neighborhood: Neighborhood | null;
    };

const SEARCH_DEBOUNCE_MS = 300;

export function SupplyFeedSearch() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopsLoading, setShopsLoading] = useState(true);
  const [shopsError, setShopsError] = useState<string | null>(null);
  const [selectedShop, setSelectedShop] = useState("");
  const [query, setQuery] = useState("");
  const [hexInput, setHexInput] = useState("#c41e3a");
  const [view, setView] = useState<ViewState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load shops list on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tools/embroidery-supplies/search");
        if (!res.ok) throw new Error(`Shop load failed (${res.status})`);
        const data = (await res.json()) as { shops: Shop[] };
        if (!cancelled) setShops(data.shops ?? []);
      } catch (err) {
        if (!cancelled)
          setShopsError(
            err instanceof Error ? err.message : "Failed to load shops",
          );
      } finally {
        if (!cancelled) setShopsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Text search within shop (debounced).
  useEffect(() => {
    if (!selectedShop) {
      setView(null);
      return;
    }
    if (view?.kind === "matches") return;

    setView({ kind: "searching" });
    setError(null);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ shopping_source: selectedShop });
        if (query) params.set("q", query);
        const res = await fetch(
          `/api/tools/embroidery-supplies/search?${params}`,
        );
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = (await res.json()) as { candidates: Candidate[] };
        setView({ kind: "candidates", results: data.candidates ?? [] });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setView({ kind: "candidates", results: [] });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // view intentionally omitted — re-triggering on view changes would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShop, query]);

  const showMatchesFor = useCallback(async (candidate: Candidate) => {
    if (!candidate.hex) {
      setError("That color has no hex value — can't match across brands yet.");
      return;
    }
    setView({ kind: "searching" });
    setError(null);
    try {
      const params = new URLSearchParams({ hex: candidate.hex });
      params.set("length_yds", String(candidate.length_yds));
      const res = await fetch(
        `/api/tools/embroidery-supplies/search?${params}`,
      );
      if (!res.ok) throw new Error(`Match lookup failed (${res.status})`);
      const data = (await res.json()) as {
        reference_hex: string;
        anchor_length_yds: number | null;
        tolerance: number;
        total: number;
        matches: ColorMatch[];
        neighborhood?: Neighborhood;
      };
      setView({
        kind: "matches",
        anchor: candidate,
        referenceHex: data.reference_hex,
        matches: data.matches ?? [],
        total: data.total ?? 0,
        tolerance: data.tolerance ?? 0,
        neighborhood: data.neighborhood ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Match lookup failed");
    }
  }, []);

  const searchByHex = useCallback(async (hex: string, tol = SUPPLY_DEFAULT_TOLERANCE) => {
    const clean = normalizeHexInput(hex);
    if (!clean) {
      setError("Enter a valid hex like #c41e3a or c41e3a.");
      return;
    }
    setView({ kind: "searching" });
    setError(null);
    try {
      // Wider tolerance for direct hex search — the user is browsing the
      // color neighborhood (e.g. "show me near-blacks"), not validating a
      // specific anchor thread. Anchor-based searches stay tight (±5) so
      // cross-brand equivalents show cleanly.
      const params = new URLSearchParams({ hex: clean, tol: String(tol) });
      const res = await fetch(
        `/api/tools/embroidery-supplies/search?${params}`,
      );
      if (!res.ok) throw new Error(`Hex lookup failed (${res.status})`);
      const data = (await res.json()) as {
        reference_hex: string;
        tolerance: number;
        total: number;
        matches: ColorMatch[];
        neighborhood?: Neighborhood;
      };
      setView({
        kind: "matches",
        anchor: null,
        referenceHex: data.reference_hex,
        matches: data.matches ?? [],
        total: data.total ?? 0,
        tolerance: data.tolerance ?? 0,
        neighborhood: data.neighborhood ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hex lookup failed");
    }
  }, []);

  // Hydrate from `?hex=…&tol=…` on mount AND whenever those query params
  // change. Same-path client-side navigations (e.g. clicking a different
  // match tile from the AI assistant) don't remount the component, so a
  // mount-only effect would miss the change.
  const searchParams = useSearchParams();
  const urlHex = searchParams.get("hex");
  const urlTol = searchParams.get("tol");
  const lastAppliedHexRef = useRef<string | null>(null);

  useEffect(() => {
    if (!urlHex) return;
    const normalized = normalizeHexInput(urlHex);
    if (!normalized) return;
    // Skip if we already rendered this exact hex — avoids re-fetching on
    // unrelated state updates that happen to re-run the effect.
    if (lastAppliedHexRef.current === normalized) return;
    lastAppliedHexRef.current = normalized;

    const tol =
      urlTol && !Number.isNaN(parseFloat(urlTol))
        ? parseFloat(urlTol)
        : SUPPLY_DEFAULT_TOLERANCE;
    setHexInput(normalized);
    searchByHex(urlHex, tol);

    // Next.js same-path navigation doesn't reliably re-scroll to the hash;
    // do it ourselves when the hex query changes.
    if (typeof window !== "undefined") {
      const target = document.getElementById("thread-lookup");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [urlHex, urlTol, searchByHex]);

  const goBack = () => setView(null);

  const shopOptions = useMemo(
    () =>
      shops.map((s) => (
        <option key={s.name} value={s.name}>
          {s.name} ({s.product_count})
        </option>
      )),
    [shops],
  );

  return (
    <div
      id="thread-lookup"
      className="space-y-4 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 scroll-mt-20"
    >
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
        <Search size={16} />
        <span className="font-mono uppercase tracking-wider">
          Thread lookup
        </span>
      </div>

      {view?.kind !== "matches" ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              value={selectedShop}
              onChange={(e) => setSelectedShop(e.target.value)}
              disabled={shopsLoading || !!shopsError}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] sm:w-56"
            >
              <option value="">
                {shopsLoading
                  ? "Loading outlets…"
                  : shopsError
                    ? "Failed to load"
                    : `Pick an outlet (${shops.length})`}
              </option>
              {shopOptions}
            </select>
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Color name or number (e.g. Cornsilk or 502)"
              disabled={!selectedShop}
              className="flex-1"
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:items-center">
            <span className="text-xs uppercase tracking-wider text-[var(--color-text-muted)] sm:w-56">
              Or search by hex
            </span>
            <div className="flex flex-1 items-center gap-2">
              <input
                type="color"
                value={normalizeHexInput(hexInput) ?? "#c41e3a"}
                onChange={(e) => setHexInput(e.target.value)}
                className="h-9 w-10 flex-none cursor-pointer rounded-lg border border-[var(--color-border)] bg-transparent"
                aria-label="Hex color picker"
              />
              <Input
                type="text"
                value={hexInput}
                onChange={(e) => setHexInput(e.target.value)}
                placeholder="#c41e3a"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    searchByHex(hexInput);
                  }
                }}
                className="flex-1 font-mono"
              />
              <button
                type="button"
                onClick={() => searchByHex(hexInput)}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]"
              >
                Find colors
              </button>
            </div>
          </div>
          {shopsError && (
            <p className="text-sm text-[var(--color-status-error)]">
              {shopsError}
            </p>
          )}
          {error && (
            <p className="text-sm text-[var(--color-status-error)]">{error}</p>
          )}
          {view?.kind === "searching" && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Searching…
            </p>
          )}
          {view?.kind === "candidates" && (
            <CandidateList
              results={view.results}
              onPick={showMatchesFor}
              hasQuery={Boolean(query)}
            />
          )}
          {!view && selectedShop === "" && !shopsLoading && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Pick an outlet above to start searching. Click any result to see
              same-color, same-length offerings from every other outlet.
            </p>
          )}
        </>
      ) : (
        <MatchesView view={view} onBack={goBack} />
      )}
    </div>
  );
}

function CandidateList({
  results,
  onPick,
  hasQuery,
}: {
  results: Candidate[];
  onPick: (c: Candidate) => void;
  hasQuery: boolean;
}) {
  if (results.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        {hasQuery
          ? "No threads matched that name or number at this outlet."
          : "Type a color name or number to narrow down."}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
        {results.length} match{results.length === 1 ? "" : "es"} — click to see
        the same color across every outlet
      </p>
      <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)]">
        {results.map((r) => (
          <li key={r.product_key}>
            <button
              type="button"
              onClick={() => onPick(r)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-[var(--color-surface-raised)]"
            >
              <ColorSwatch hex={r.hex} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-[var(--color-text-primary)]">
                  {r.color_name ?? "(no name)"}
                </div>
                <div className="truncate text-xs text-[var(--color-text-muted)]">
                  #{r.color_number} · {r.brand} · {r.product_line} ·{" "}
                  {fmtYards(r.length_yds)}
                  {r.hex && ` · ${r.hex}`}
                </div>
              </div>
              <ListingSummary listings={r.listings} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Canonical outlet column ordering. OhMyCrafty leads; everything else
// follows the order vendors were added to compile-feeds.ts:VENDOR_NAMES.
// Display labels mirror compile-feeds.ts:SHOPPING_SOURCE.
//
// This is the *full* set; PivotTable filters down to columns that have at
// least one populated cell in the current matches, padding with empty
// placeholders to MIN_PIVOT_COLUMNS for visual consistency.
const ALL_OUTLET_COLUMNS = [
  "OhMyCrafty",
  "Gunold",
  "Sulky",
  "AllStitch",
  "Hab+Dash",
  "ColDesi",
  "ThreadArt",
] as const;

function MatchesView({
  view,
  onBack,
}: {
  view: Extract<ViewState, { kind: "matches" }>;
  onBack: () => void;
}) {
  const { anchor, referenceHex, matches, total, tolerance, neighborhood } =
    view;
  const weightGroups = useMemo(
    () => pivotByWeightThenColor(matches),
    [matches],
  );

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
      >
        <ChevronLeft size={14} /> Back to search
      </button>

      <div className="flex items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <ColorSwatch hex={anchor?.hex ?? referenceHex} large />
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
            {anchor ? "Anchor" : "Hex search"}
          </div>
          {anchor ? (
            <>
              <div className="font-medium text-[var(--color-text-primary)]">
                {anchor.color_name ?? "(no name)"}
              </div>
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <span>
                  #{anchor.color_number} · {anchor.brand} · {anchor.product_line} ·{" "}
                  {fmtYards(anchor.length_yds)} · {referenceHex}
                </span>
                <MaterialChip material={anchor.material} />
              </div>
            </>
          ) : (
            <div className="font-mono text-[var(--color-text-primary)]">
              {referenceHex}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
        {total} match{total === 1 ? "" : "es"} within ±{tolerance} RGB ·
        grouped by color, prices per length
      </p>

      {neighborhood && (
        <NeighborhoodStrip
          neighborhood={neighborhood}
          tolerance={tolerance}
          referenceHex={referenceHex}
        />
      )}

      {weightGroups.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No other threads found within the color tolerance.
        </p>
      ) : (
        <div className="space-y-8">
          {weightGroups.map((g) => (
            <WeightSection
              key={g.thread_weight === null ? "unknown" : g.thread_weight}
              group={g}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Explore nearby" row — 5 color swatches: two outward steps, the current
 * color, two outward steps the other way. The outward-step hexes come
 * from the feed and are spaced > 2 * tolerance apart so each lands on a
 * non-overlapping match set when clicked.
 */
function NeighborhoodStrip({
  neighborhood,
  tolerance,
  referenceHex,
}: {
  neighborhood: Neighborhood;
  tolerance: number;
  referenceHex: string;
}) {
  // Slots rendered left-to-right: farther → nearer → current → nearer → farther.
  const slots: Array<{ entry: NeighborhoodEntry | null; current?: boolean }> = [
    { entry: neighborhood.left[1] ?? null },
    { entry: neighborhood.left[0] ?? null },
    {
      entry: { hex: referenceHex, distance_from_reference: 0 },
      current: true,
    },
    { entry: neighborhood.right[0] ?? null },
    { entry: neighborhood.right[1] ?? null },
  ];

  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
        Explore nearby colors
      </p>
      <div className="mt-2 grid grid-cols-5 gap-2">
        {slots.map((slot, i) => {
          if (!slot.entry) {
            return (
              <div
                key={i}
                className="h-[72px] rounded-lg border border-dashed border-[var(--color-border)]"
                aria-hidden
              />
            );
          }
          const hex = slot.entry.hex;
          const hexNoHash = hex.replace(/^#/, "");
          if (slot.current) {
            return (
              <div
                key={i}
                className="flex flex-col gap-1 rounded-lg border-2 border-[var(--color-brand-primary)] bg-[var(--color-surface-elevated)] p-1"
                aria-label={`Current color ${hex}`}
              >
                <span
                  className="h-12 w-full rounded-md"
                  style={{ backgroundColor: hex }}
                />
                <span className="text-center font-mono text-[10px] text-[var(--color-text-primary)]">
                  {hex.toUpperCase()}
                </span>
              </div>
            );
          }
          return (
            <Link
              key={i}
              href={`/tools/embroidery-supplies?hex=${hexNoHash}&tol=${tolerance}#thread-lookup`}
              className="flex flex-col gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-1 transition-shadow hover:shadow-sm"
              aria-label={`Search around ${hex}`}
            >
              <span
                className="h-12 w-full rounded-md"
                style={{ backgroundColor: hex }}
              />
              <span className="text-center font-mono text-[10px] text-[var(--color-text-muted)]">
                {hex.toUpperCase()}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

type LengthRow = {
  length_yds: number;
  /** Per shopping_source column, the closest-distance match that has a
   *  listing for that shop. The match holds the listing data inline. */
  cells: Partial<Record<string, ColorMatch>>;
};

type ColorBlock = {
  bucketKey: string;
  representative: ColorMatch;
  rows: LengthRow[];
};

function hexBucketKey(hex: string | null): string | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  // Round each channel to nearest 8 so small image-sample noise collapses
  // (matches within ±5 RGB land in same bucket most of the time).
  const round = (c: string) => (parseInt(c, 16) >> 3) << 3;
  return `${round(m[1])},${round(m[2])},${round(m[3])}`;
}

type WeightGroup = {
  thread_weight: number | null;
  blocks: ColorBlock[];
};

/**
 * Group matches first by thread weight (12wt vs 40wt vs 60wt etc. aren't
 * directly comparable products, so each gets its own table), then within
 * each weight group apply the color-bucket pivot.
 */
function pivotByWeightThenColor(matches: ColorMatch[]): WeightGroup[] {
  const byWeight = new Map<string, ColorMatch[]>();
  for (const m of matches) {
    const wk = m.thread_weight === null ? "unknown" : String(m.thread_weight);
    if (!byWeight.has(wk)) byWeight.set(wk, []);
    byWeight.get(wk)!.push(m);
  }
  const groups: WeightGroup[] = [];
  for (const [wk, weightMatches] of byWeight.entries()) {
    const blocks = pivotByColor(weightMatches);
    if (blocks.length === 0) continue;
    groups.push({
      thread_weight: wk === "unknown" ? null : Number(wk),
      blocks,
    });
  }
  // Ascending weight (12, 30, 40, 60…); unknown last.
  groups.sort((a, b) => {
    if (a.thread_weight === null) return 1;
    if (b.thread_weight === null) return -1;
    return a.thread_weight - b.thread_weight;
  });
  return groups;
}

function pivotByColor(matches: ColorMatch[]): ColorBlock[] {
  // 1. Group matches by color bucket.
  const byBucket = new Map<string, ColorMatch[]>();
  for (const m of matches) {
    const bk = hexBucketKey(m.hex);
    if (!bk) continue;
    if (!byBucket.has(bk)) byBucket.set(bk, []);
    byBucket.get(bk)!.push(m);
  }

  const blocks: ColorBlock[] = [];
  for (const [bk, items] of byBucket.entries()) {
    // Representative = closest match to anchor (smallest distance).
    let representative = items[0];
    for (const m of items) {
      if (m.distance < representative.distance) representative = m;
    }

    // 2. Within each color bucket, group by length.
    const byLen = new Map<number, LengthRow>();
    for (const m of items) {
      const lk = m.length_yds;
      let row = byLen.get(lk);
      if (!row) {
        row = { length_yds: m.length_yds, cells: {} };
        byLen.set(lk, row);
      }
      // For each shop the match has a listing on, claim that cell if this
      // match is closer to anchor than whatever's already there.
      for (const shop of Object.keys(m.listings)) {
        const existing = row.cells[shop];
        if (!existing || m.distance < existing.distance) {
          row.cells[shop] = m;
        }
      }
    }

    const rows: LengthRow[] = [...byLen.values()];
    rows.sort((a, b) => a.length_yds - b.length_yds);

    blocks.push({ bucketKey: bk, representative, rows });
  }

  // Anchor-color block first, then nearest colors next.
  blocks.sort(
    (a, b) => a.representative.distance - b.representative.distance,
  );
  return blocks;
}

function WeightSection({ group }: { group: WeightGroup }) {
  const label =
    group.thread_weight !== null
      ? `${group.thread_weight} wt thread`
      : "Weight not specified";
  return (
    <div className="space-y-2">
      <h3 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
        {label}
      </h3>
      <PivotTable blocks={group.blocks} />
    </div>
  );
}

// Minimum column count for the pivot table. Even when fewer outlets carry
// any of the matched colors, pad to this many empty placeholder columns so
// the table holds a consistent visual width across searches.
const MIN_PIVOT_COLUMNS = 4;

function PivotTable({ blocks }: { blocks: ColorBlock[] }) {
  // Sparse columns + 4-column minimum. Every outlet with at least one
  // populated cell is included; if fewer than MIN_PIVOT_COLUMNS show up,
  // pad with the next-in-canonical-order missing outlets as empty
  // placeholders. The combined set is filtered through ALL_OUTLET_COLUMNS
  // at the end so the final ordering is always canonical regardless of
  // whether an outlet came in via data or via padding.
  const visibleColumns = useMemo(() => {
    const present = new Set<string>();
    for (const block of blocks) {
      for (const row of block.rows) {
        for (const outlet of Object.keys(row.cells)) present.add(outlet);
      }
    }
    const populated = ALL_OUTLET_COLUMNS.filter((o) => present.has(o));
    if (populated.length >= MIN_PIVOT_COLUMNS) return populated;
    const filler = ALL_OUTLET_COLUMNS.filter((o) => !present.has(o)).slice(
      0,
      MIN_PIVOT_COLUMNS - populated.length,
    );
    const include = new Set<string>([...populated, ...filler]);
    return ALL_OUTLET_COLUMNS.filter((o) => include.has(o));
  }, [blocks]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]">
              <th className="px-4 py-2 text-left font-medium text-[var(--color-text-muted)]">
                Length
              </th>
              {visibleColumns.map((m) => (
                <th
                  key={m}
                  className="px-4 py-2 text-right font-medium text-[var(--color-text-muted)]"
                >
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => (
              <Fragment key={block.bucketKey}>
                <tr className="border-y-2 border-[var(--color-border)] bg-[var(--color-surface)]">
                  <td
                    colSpan={1 + visibleColumns.length}
                    className="px-4 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <ColorSwatch hex={block.representative.hex} />
                      <div className="min-w-0 flex-1">
                        {block.representative.color_name ? (
                          <>
                            <div className="font-medium text-[var(--color-text-primary)]">
                              {block.representative.color_name}
                            </div>
                            <div className="font-mono text-xs text-[var(--color-text-muted)]">
                              #{block.representative.color_number} ·{" "}
                              {block.representative.hex}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-mono text-[var(--color-text-primary)]">
                              {block.representative.hex}
                            </div>
                            <div className="font-mono text-xs text-[var(--color-text-muted)]">
                              #{block.representative.color_number}
                            </div>
                          </>
                        )}
                      </div>
                      <MaterialChip material={block.representative.material} />
                    </div>
                  </td>
                </tr>
                {block.rows.map((row) => (
                  <tr
                    key={`${block.bucketKey}|${row.length_yds}`}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="px-4 py-2 text-[var(--color-text-secondary)]">
                      {fmtYards(row.length_yds)}
                    </td>
                    {visibleColumns.map((outlet) => {
                      const match = row.cells[outlet];
                      return (
                        <td
                          key={outlet}
                          className="px-4 py-2 text-right font-mono tabular-nums"
                        >
                          <PivotCell match={match ?? null} shop={outlet} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PivotCell({
  match,
  shop,
}: {
  match: ColorMatch | null;
  shop: string;
}) {
  if (!match) {
    return <span className="text-[var(--color-text-muted)]">—</span>;
  }
  const listing = match.listings[shop];
  if (!listing) {
    return <span className="text-[var(--color-text-muted)]">—</span>;
  }
  const hasPrice = listing.price !== null;
  const hasQty = listing.qty !== null;
  const hasCost = listing.cost !== null;

  const title = `${match.brand} · ${match.product_line} · #${match.color_number}${hasPrice ? "" : " — price not public"}`;

  const priceNode = hasPrice ? (
    <span className="text-[var(--color-text-primary)]">
      ${listing.price!.toFixed(2)}
    </span>
  ) : (
    // Listing exists but vendor gates pricing (e.g. Hab+Dash dealer login).
    // Still surface the listing via a "Check price" link.
    <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
      Check price
      <ExternalLink size={11} />
    </span>
  );

  const priceLine = (
    <span className="inline-flex items-baseline gap-1">
      {priceNode}
      {hasQty && (
        <span className="text-xs text-[var(--color-text-muted)]">
          ({listing.qty})
        </span>
      )}
    </span>
  );

  return (
    <div className="flex flex-col items-end leading-tight">
      {listing.url ? (
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-[var(--color-brand-primary-deep)] hover:underline"
          title={title}
        >
          {priceLine}
        </a>
      ) : (
        <span title={title}>{priceLine}</span>
      )}
      {hasCost && (
        <span
          className="text-xs text-[var(--color-status-error)]"
          title="Wholesale cost"
        >
          ${listing.cost!.toFixed(2)} (cost)
        </span>
      )}
    </div>
  );
}

function fmtYards(yds: number): string {
  if (yds >= 1000) {
    const k = yds / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k yds`;
  }
  return `${yds} yds`;
}

/**
 * Accept `#c41e3a`, `c41e3a`, `C41E3A`, or the 3-digit shorthand `#c13` →
 * normalize to lowercase `#c41e3a`. Returns null if the input isn't a
 * recognizable hex string so the caller can surface a validation error.
 */
function normalizeHexInput(raw: string): string | null {
  const s = raw.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  if (/^[0-9a-f]{3}$/.test(s)) {
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  }
  return null;
}

function ColorSwatch({
  hex,
  large,
}: {
  hex: string | null;
  large?: boolean;
}) {
  const size = large ? "h-12 w-12" : "h-8 w-8";
  return (
    <span
      className={`${size} flex-none rounded-lg border border-[var(--color-border)]`}
      style={{ backgroundColor: hex ?? "transparent" }}
      aria-label={hex ?? "no color"}
    />
  );
}

/**
 * Tiny pill showing the fiber type. Helps disambiguate cases where the same
 * brand has multiple lines at the same color number — e.g. Madeira Polyneon
 * #1234 vs Madeira Rayon #1234 are deliberately matched colors but
 * physically different threads.
 */
function MaterialChip({ material }: { material: string }) {
  if (!material || material === "unknown") return null;
  return (
    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
      {material}
    </span>
  );
}

function ListingSummary({ listings }: { listings: Record<string, Listing> }) {
  // Sort by canonical outlet order so the per-row summary matches the
  // pivot table's column order. Without this, entries come back in
  // API-response order (alpha by shopping_source) which feels random
  // next to the canonical column ordering.
  const entries = Object.entries(listings).sort(([a], [b]) => {
    const ia = ALL_OUTLET_COLUMNS.indexOf(
      a as (typeof ALL_OUTLET_COLUMNS)[number],
    );
    const ib = ALL_OUTLET_COLUMNS.indexOf(
      b as (typeof ALL_OUTLET_COLUMNS)[number],
    );
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  if (entries.length === 0) {
    return (
      <span className="text-xs text-[var(--color-text-muted)]">no listing</span>
    );
  }
  return (
    <div className="hidden shrink-0 flex-col gap-0.5 text-right font-mono text-xs sm:flex">
      {entries.map(([shop, listing]) => (
        <div key={shop} className="flex items-center justify-end gap-2">
          <span className="text-[var(--color-text-muted)]">{shop}</span>
          <span className="tabular-nums text-[var(--color-text-primary)]">
            {listing.price != null ? `$${listing.price.toFixed(2)}` : "—"}
            {listing.qty != null && listing.qty !== 0 && (
              <span className="ml-1 text-[var(--color-text-muted)]">
                ({listing.qty})
              </span>
            )}
          </span>
          {listing.url && (
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-brand-primary-deep)] hover:underline"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Open ${shop} listing`}
            >
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
