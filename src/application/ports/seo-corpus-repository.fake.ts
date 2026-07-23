import { type SerpObservation } from "@/domain/seo/serp-facts";
import { type KeywordMetric } from "@/application/ports/keyword-metrics-gateway";
import {
  type PageSnapshotRow,
  type SeoCorpusRepository,
} from "@/application/ports/seo-corpus-repository";

/**
 * In-memory {@link SeoCorpusRepository}. Holds the same three collections the
 * Mongo adapter does and applies the same `(query, location)` keying, so a test
 * can assert the flywheel writes (a snapshot was appended, a page snapshot was
 * skipped because the hash was unchanged) without a database.
 *
 * `now` is injected rather than read from the clock — freshness windows are the
 * thing under test, and a test that depends on wall-clock time is a test that
 * fails at midnight.
 */
export class FakeSeoCorpusRepository implements SeoCorpusRepository {
  readonly snapshots: SerpObservation[] = [];
  readonly pageSnapshots: PageSnapshotRow[] = [];
  readonly keywordMetrics: Array<KeywordMetric & { location: string }> = [];

  constructor(
    seed: {
      snapshots?: SerpObservation[];
      pageSnapshots?: PageSnapshotRow[];
      keywordMetrics?: Array<KeywordMetric & { location: string }>;
    } = {},
    private readonly now: () => Date = () => new Date(),
  ) {
    this.snapshots.push(...(seed.snapshots ?? []));
    this.pageSnapshots.push(...(seed.pageSnapshots ?? []));
    this.keywordMetrics.push(...(seed.keywordMetrics ?? []));
  }

  private matching(query: string, location: string): SerpObservation[] {
    return this.snapshots
      .filter((s) => s.query === query && s.location === location)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  }

  async findRecentSnapshot(input: {
    query: string;
    location: string;
    maxAgeDays: number;
  }): Promise<SerpObservation | null> {
    const cutoff =
      this.now().getTime() - input.maxAgeDays * 24 * 60 * 60 * 1000;
    const fresh = this.matching(input.query, input.location).filter(
      (s) => new Date(s.capturedAt).getTime() >= cutoff,
    );
    return fresh.length > 0 ? fresh[fresh.length - 1] : null;
  }

  async findSnapshots(input: {
    query: string;
    location: string;
    since: string;
  }): Promise<SerpObservation[]> {
    return this.matching(input.query, input.location).filter(
      (s) => s.capturedAt >= input.since,
    );
  }

  async saveSnapshot(observation: SerpObservation): Promise<void> {
    this.snapshots.push(observation);
  }

  async savePageSnapshot(row: PageSnapshotRow): Promise<void> {
    this.pageSnapshots.push(row);
  }

  async latestPageContentHash(url: string): Promise<string | null> {
    const rows = this.pageSnapshots
      .filter((r) => r.url === url)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    return rows.length > 0 ? rows[rows.length - 1].contentHash : null;
  }

  async upsertKeywordMetrics(input: {
    location: string;
    metrics: KeywordMetric[];
  }): Promise<void> {
    for (const metric of input.metrics) {
      const index = this.keywordMetrics.findIndex(
        (m) => m.query === metric.query && m.location === input.location,
      );
      const row = { ...metric, location: input.location };
      if (index >= 0) this.keywordMetrics[index] = row;
      else this.keywordMetrics.push(row);
    }
  }

  async findKeywordMetrics(input: {
    queries: string[];
    location: string;
    maxAgeDays: number;
  }): Promise<KeywordMetric[]> {
    const cutoff =
      this.now().getTime() - input.maxAgeDays * 24 * 60 * 60 * 1000;
    return this.keywordMetrics.filter(
      (m) =>
        m.location === input.location &&
        input.queries.includes(m.query) &&
        new Date(m.capturedAt).getTime() >= cutoff,
    );
  }
}
