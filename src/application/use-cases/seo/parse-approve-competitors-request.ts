import { ok, err, type Result } from "@/domain/shared/result";
import {
  isRecord,
  stringArray,
  type FieldError,
} from "@/application/use-cases/seo/request-fields";

/**
 * Structural validation for `PATCH /api/seo/runs/[runId]` — the layer-1 gate.
 *
 * `domains` is required but may be **empty**: rejecting every competitor is a
 * real decision, and it has to be distinguishable from "the caller forgot to
 * send the field", which is why an absent key is an error while `[]` is not.
 */

const MAX_DOMAINS = 30;

export interface ApproveCompetitorsBody {
  domains: string[];
}

export function parseApproveCompetitorsRequest(
  body: unknown,
): Result<ApproveCompetitorsBody, FieldError[]> {
  if (!isRecord(body)) {
    return err([{ field: "body", message: "Expected a JSON object." }]);
  }

  if (body.domains === undefined || body.domains === null) {
    return err([
      {
        field: "domains",
        message:
          "Required. Send an empty array to reject every observed competitor.",
      },
    ]);
  }

  const domains = stringArray(body.domains);
  if (domains === null) {
    return err([
      { field: "domains", message: "Must be an array of domain strings." },
    ]);
  }
  if (domains.length > MAX_DOMAINS) {
    return err([
      { field: "domains", message: `At most ${MAX_DOMAINS} domains.` },
    ]);
  }

  return ok({ domains });
}
