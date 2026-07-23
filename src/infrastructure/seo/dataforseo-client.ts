/**
 * The DataForSEO transport, shared by every adapter that talks to them.
 *
 * Owns exactly three things: credentials, the POST envelope (every v3 endpoint
 * takes an ARRAY of task objects, even for one task), and the vendor's
 * two-level status codes — an HTTP 200 can still carry a task-level failure, so
 * `status_code` is checked at both levels or errors read as empty results.
 *
 * Cost is read off the response, never computed here: seo.md is explicit that
 * quoted prices drift upward and must never be hardcoded.
 */

const BASE_URL = "https://api.dataforseo.com/v3";
const REQUEST_TIMEOUT_MS = 60_000;
/** DataForSEO's "task succeeded" code. Anything else is a failure. */
const TASK_OK = 20000;

export interface DataForSeoTask<T> {
  id?: string;
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: T[] | null;
}

export interface DataForSeoResponse<T> {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: Array<DataForSeoTask<T>>;
}

export class DataForSeoNotConfiguredError extends Error {
  constructor() {
    super(
      "DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set. The SEO API fails closed without them.",
    );
    this.name = "DataForSeoNotConfiguredError";
  }
}

export class DataForSeoRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | undefined,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DataForSeoRequestError";
  }
}

export function isDataForSeoConfigured(): boolean {
  return Boolean(
    process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD,
  );
}

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new DataForSeoNotConfiguredError();
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

/**
 * POST one task to a v3 endpoint and return its first result plus the reported
 * cost. Rejects with {@link DataForSeoRequestError} on transport failure, an
 * HTTP error, a top-level vendor error, or a task-level error.
 */
export async function postTask<T>(
  path: string,
  task: Record<string, unknown>,
): Promise<{ result: T[]; cost: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: authHeader(),
        "content-type": "application/json",
      },
      // Every v3 endpoint takes an array of tasks. One task, still an array.
      body: JSON.stringify([task]),
    });
  } catch (cause) {
    if (cause instanceof DataForSeoNotConfiguredError) throw cause;
    throw new DataForSeoRequestError(
      `DataForSEO ${path} request failed.`,
      undefined,
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new DataForSeoRequestError(
      `DataForSEO ${path} returned HTTP ${response.status}.`,
      response.status,
    );
  }

  const payload = (await response.json()) as DataForSeoResponse<T>;
  if (payload.status_code !== undefined && payload.status_code !== TASK_OK) {
    throw new DataForSeoRequestError(
      `DataForSEO ${path}: ${payload.status_message ?? "unknown error"}.`,
      payload.status_code,
    );
  }

  const [first] = payload.tasks ?? [];
  if (!first) {
    throw new DataForSeoRequestError(
      `DataForSEO ${path} returned no tasks.`,
      payload.status_code,
    );
  }
  if (first.status_code !== undefined && first.status_code !== TASK_OK) {
    throw new DataForSeoRequestError(
      `DataForSEO ${path} task failed: ${first.status_message ?? "unknown error"}.`,
      first.status_code,
    );
  }

  return {
    result: first.result ?? [],
    // Task-level cost when present, else the envelope's. Reported, never derived.
    cost: first.cost ?? payload.cost ?? 0,
  };
}
