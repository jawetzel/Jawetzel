import { type WorkOrder } from "@/domain/seo/work-order";
import {
  type SeoAnalysisRepository,
  type StoredPageAnalysis,
} from "@/application/ports/seo-analysis-repository";

/**
 * In-memory {@link SeoAnalysisRepository}. Lets a use-case test assert that a run
 * was persisted (and read back newest-first) without a database.
 *
 * Ids mirror the Mongo adapter's contract: assigned on save, present on read.
 * A seeded row keeps whatever id it was given so a test can address it.
 */
export class FakeSeoAnalysisRepository implements SeoAnalysisRepository {
  readonly saved: StoredPageAnalysis[] = [];
  private readonly workOrders = new Map<string, WorkOrder>();
  private nextId = 1;

  constructor(seed: StoredPageAnalysis[] = []) {
    for (const row of seed) {
      this.saved.push({ ...row, id: row.id ?? `analysis-${this.nextId++}` });
    }
  }

  async save(record: StoredPageAnalysis): Promise<string> {
    const id = `analysis-${this.nextId++}`;
    this.saved.push({ ...record, id });
    return id;
  }

  async listRecent(input: { limit: number }): Promise<StoredPageAnalysis[]> {
    return [...this.saved]
      .sort((a, b) => b.runAt.localeCompare(a.runAt))
      .slice(0, input.limit);
  }

  async findById(id: string): Promise<StoredPageAnalysis | null> {
    return this.saved.find((row) => row.id === id) ?? null;
  }

  async saveWorkOrder(input: {
    analysisId: string;
    workOrder: WorkOrder;
  }): Promise<void> {
    this.workOrders.set(input.analysisId, input.workOrder);
  }

  async findWorkOrder(analysisId: string): Promise<WorkOrder | null> {
    return this.workOrders.get(analysisId) ?? null;
  }
}
