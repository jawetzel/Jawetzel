import { type IntelRun, type SeoTag } from "@/domain/seo/workspace";
import { type SeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository";

/**
 * InMemorySeoWorkspaceRepository — the port's test double.
 *
 * Same observable contract as the Mongo adapter: upsert by key, runs listed
 * newest first, reads return copies so a test that mutates a returned run
 * cannot corrupt the store behind it.
 */
export class InMemorySeoWorkspaceRepository implements SeoWorkspaceRepository {
  private readonly tags = new Map<string, SeoTag>();
  private readonly runs = new Map<string, IntelRun>();

  constructor(seed?: { tags?: SeoTag[]; runs?: IntelRun[] }) {
    for (const tag of seed?.tags ?? []) this.tags.set(tag.tag, tag);
    for (const run of seed?.runs ?? []) this.runs.set(run.runId, run);
  }

  async saveTag(tag: SeoTag): Promise<void> {
    // Mirror the adapter's `$setOnInsert`: createdAt belongs to the first write.
    const existing = this.tags.get(tag.tag);
    this.tags.set(tag.tag, {
      ...tag,
      createdAt: existing?.createdAt ?? tag.createdAt,
    });
  }

  async findTag(tag: string): Promise<SeoTag | null> {
    const found = this.tags.get(tag);
    return found ? { ...found } : null;
  }

  async listTags(): Promise<SeoTag[]> {
    return [...this.tags.values()]
      .map((t) => ({ ...t }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async saveRun(run: IntelRun): Promise<void> {
    const existing = this.runs.get(run.runId);
    this.runs.set(run.runId, {
      ...run,
      createdAt: existing?.createdAt ?? run.createdAt,
    });
  }

  async findRun(runId: string): Promise<IntelRun | null> {
    const found = this.runs.get(runId);
    return found ? { ...found } : null;
  }

  async listRuns(input: { tag: string; limit: number }): Promise<IntelRun[]> {
    return [...this.runs.values()]
      .filter((r) => r.tag === input.tag)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit)
      .map((r) => ({ ...r }));
  }
}
