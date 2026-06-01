import { submitToIndexNow } from "@/lib/indexnow";
import {
  type IndexNowSubmitter,
  type IndexNowSubmissionResult,
} from "@/application/ports/indexnow-submitter";

/**
 * HttpIndexNowSubmitter — the production {@link IndexNowSubmitter}. It delegates
 * to the unchanged `src/lib/indexnow.submitToIndexNow`, which owns the IndexNow
 * protocol details: batching (up to 1000 URLs/request), the key/host/keyLocation
 * payload, and the best-effort swallowing of transport errors (`ok` is true only
 * when every batch returned 200/202). This is the *only* indirection added; the
 * submission logic stays in `lib/indexnow`.
 */
export class HttpIndexNowSubmitter implements IndexNowSubmitter {
  async submit(urls: string[]): Promise<IndexNowSubmissionResult> {
    return submitToIndexNow(urls);
  }
}
