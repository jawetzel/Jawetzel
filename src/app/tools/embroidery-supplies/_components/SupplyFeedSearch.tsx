"use client";

import { Search, ExternalLink, ChevronLeft } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

type Shop = { name: string; color_count: number };

type VendorRow = {
  price: number | null;
  cost: number | null;
  qty: number | null;
  url: string | null;
};

type Candidate = {
  key: string;
  shopping_source: string;
  manufacturer: string | null;
  brand: string;
  color_number: string;
  color_name: string | null;
  hex: string | null;
  length_yds: number | null;
  thread_weight: number | null;
  vendors: Record<string, VendorRow>;
};

type ColorMatch = Candidate & {
  distance: number;
  length_delta: number | null;
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
      if (candidate.length_yds !== null)
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
      };
      setView({
        kind: "matches",
        anchor: candidate,
        referenceHex: data.reference_hex,
        matches: data.matches ?? [],
        total: data.total ?? 0,
        tolerance: data.tolerance ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Match lookup failed");
    }
  }, []);

  const searchByHex = useCallback(async (hex: string) => {
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
      const params = new URLSearchParams({ hex: clean, tol: "25" });
      const res = await fetch(
        `/api/tools/embroidery-supplies/search?${params}`,
      );
      if (!res.ok) throw new Error(`Hex lookup failed (${res.status})`);
      const data = (await res.json()) as {
        reference_hex: string;
        tolerance: number;
        total: number;
        matches: ColorMatch[];
      };
      setView({
        kind: "matches",
        anchor: null,
        referenceHex: data.reference_hex,
        matches: data.matches ?? [],
        total: data.total ?? 0,
        tolerance: data.tolerance ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hex lookup failed");
    }
  }, []);

  const goBack = () => setView(null);

  const shopOptions = useMemo(
    () =>
      shops.map((s) => (
        <option key={s.name} value={s.name}>
          {s.name} ({s.color_count})
        </option>
      )),
    [shops],
  );

  return (
    <div className="space-y-4 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6">
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
                  ? "Loading shops…"
                  : shopsError
                    ? "Failed to load"
                    : `Pick a shop (${shops.length})`}
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
              Pick a shop above to start searching. Click any result to see
              same-color, same-length offerings from every other shop.
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
          ? "No threads matched that name or number in this brand."
          : "Type a color name or number to narrow down."}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
        {results.length} match{results.length === 1 ? "" : "es"} — click to see
        cross-manufacturer equivalents
      </p>
      <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)]">
        {results.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => onPick(r)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-[var(--color-surface-raised)]"
            >
              <ColorSwatch hex={r.hex} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-[var(--color-text-primary)]">
                  {r.color_name ?? "(no name)"} · #{r.color_number}
                </div>
                <div className="truncate text-xs text-[var(--color-text-muted)]">
                  {r.brand}
                  {r.length_yds !== null && ` · ${fmtYards(r.length_yds)}`}
                  {r.hex && ` · ${r.hex}`}
                </div>
              </div>
              <VendorSummary vendors={r.vendors} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Pivot-table columns — one per shopping source. Keep in sync with the
// SHOPPING_SOURCE map in compile-feeds.ts.
const SHOP_COLUMNS = [
  "AllStitch",
  "ColDesi",
  "Gunold",
  "Hab+Dash",
  "Sulky",
  "ThreadArt",
] as const;

function MatchesView({
  view,
  onBack,
}: {
  view: Extract<ViewState, { kind: "matches" }>;
  onBack: () => void;
}) {
  const { anchor, referenceHex, matches, total, tolerance } = view;
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
                {anchor.shopping_source} · {anchor.brand}
                {anchor.manufacturer &&
                anchor.manufacturer !== anchor.shopping_source
                  ? ` · by ${anchor.manufacturer}`
                  : ""}
              </div>
              <div className="text-sm text-[var(--color-text-secondary)]">
                {anchor.color_name ?? "(no name)"} · #{anchor.color_number} ·{" "}
                {anchor.length_yds !== null
                  ? fmtYards(anchor.length_yds)
                  : "length unknown"}{" "}
                · {referenceHex}
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

type LengthRow = {
  length_yds: number | null;
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
    const byLen = new Map<
      string,
      { length_yds: number | null; cells: Partial<Record<string, ColorMatch>> }
    >();
    for (const m of items) {
      const lk = m.length_yds === null ? "unknown" : String(m.length_yds);
      if (!byLen.has(lk)) {
        byLen.set(lk, { length_yds: m.length_yds, cells: {} });
      }
      const entry = byLen.get(lk)!;
      const shop = m.shopping_source;
      const existing = entry.cells[shop];
      // Same bucket + same length + same shop → keep closest to anchor.
      if (!existing || m.distance < existing.distance) {
        entry.cells[shop] = m;
      }
    }

    const rows: LengthRow[] = [...byLen.values()];
    // Numeric ascending; unknown-length rows last.
    rows.sort((a, b) => {
      if (a.length_yds === null) return 1;
      if (b.length_yds === null) return -1;
      return a.length_yds - b.length_yds;
    });

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

function PivotTable({ blocks }: { blocks: ColorBlock[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]">
              <th className="px-4 py-2 text-left font-medium text-[var(--color-text-muted)]">
                Length
              </th>
              {SHOP_COLUMNS.map((m) => (
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
                    colSpan={1 + SHOP_COLUMNS.length}
                    className="px-4 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <ColorSwatch hex={block.representative.hex} />
                      <div className="min-w-0">
                        {block.representative.color_name ? (
                          <div className="text-[var(--color-text-primary)]">
                            <span className="font-medium">
                              {block.representative.color_name}
                            </span>
                            <span className="ml-2 font-mono text-xs text-[var(--color-text-muted)]">
                              {block.representative.hex}
                            </span>
                          </div>
                        ) : (
                          <div className="font-mono text-[var(--color-text-primary)]">
                            {block.representative.hex}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
                {block.rows.map((row) => (
                  <tr
                    key={`${block.bucketKey}|${row.length_yds ?? "unknown"}`}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="px-4 py-2 text-[var(--color-text-secondary)]">
                      {row.length_yds !== null
                        ? fmtYards(row.length_yds)
                        : "—"}
                    </td>
                    {SHOP_COLUMNS.map((shop) => {
                      const cell = row.cells[shop];
                      return (
                        <td
                          key={shop}
                          className="px-4 py-2 text-right font-mono tabular-nums"
                        >
                          <PivotCell match={cell ?? null} />
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

function PivotCell({ match }: { match: ColorMatch | null }) {
  // Empty cell — no manufacturer entry for this (color, length).
  if (!match) {
    return <span className="text-[var(--color-text-muted)]">—</span>;
  }
  const vendor = Object.entries(match.vendors)[0];
  if (!vendor) {
    return <span className="text-[var(--color-text-muted)]">—</span>;
  }
  const [, v] = vendor;
  const hasPrice = v.price !== null;
  const hasQty = v.qty !== null;
  const hasCost = v.cost !== null;

  const title = `${match.brand} #${match.color_number}${hasPrice ? "" : " — price not public"}`;

  const priceNode = hasPrice ? (
    <span className="text-[var(--color-text-primary)]">
      ${v.price!.toFixed(2)}
    </span>
  ) : (
    // Row exists but vendor gates pricing (e.g. Hab+Dash dealer login).
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
          ({v.qty})
        </span>
      )}
    </span>
  );

  return (
    <div className="flex flex-col items-end leading-tight">
      {v.url ? (
        <a
          href={v.url}
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
          ${v.cost!.toFixed(2)} (cost)
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

function VendorSummary({ vendors }: { vendors: Record<string, VendorRow> }) {
  const entries = Object.entries(vendors);
  if (entries.length === 0) {
    return (
      <span className="text-xs text-[var(--color-text-muted)]">no vendor</span>
    );
  }
  return (
    <div className="hidden shrink-0 flex-col gap-0.5 text-right font-mono text-xs sm:flex">
      {entries.map(([name, v]) => (
        <div key={name} className="flex items-center justify-end gap-2">
          <span className="text-[var(--color-text-muted)]">{name}</span>
          <span className="tabular-nums text-[var(--color-text-primary)]">
            {v.price != null
              ? `$${v.price.toFixed(2)}`
              : "—"}
            {v.qty != null && v.qty !== 0 && (
              <span className="ml-1 text-[var(--color-text-muted)]">
                ({v.qty})
              </span>
            )}
          </span>
          {v.url && (
            <a
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-brand-primary-deep)] hover:underline"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Open ${name} listing`}
            >
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

