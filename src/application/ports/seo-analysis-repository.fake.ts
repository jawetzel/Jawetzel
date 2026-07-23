import {
  type SeoAnalysisRepository,
  type StoredPageAnalysis,
} from "@/application/ports/seo-analysis-repository";

/**
 * In-memory {@link SeoAnalysisRepository}. Lets a use-case test assert that a run
 * was persisted (and read back newest-first) without a database.
 */
export class FakeSeoAnalysisRepository implements SeoAnalysisRepository {
  readonly saved: StoredPageAnalysis[] = [];

  constructor(seed: StoredPageAnalysis[] = []) {
    this.saved.push(...seed);
  }

  async save(record: StoredPageAnalysis): Promise<void> {
    this.saved.push(record);
  }

  async listRecent(input: { limit: number }): Promise<StoredPageAnalysis[]> {
    return [...this.saved]
      .sort((a, b) => b.runAt.localeCompare(a.runAt))
      .slice(0, input.limit);
  }
}
