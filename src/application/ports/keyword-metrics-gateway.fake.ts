import {
  type KeywordMetric,
  type KeywordMetricsGateway,
  type KeywordMetricsRequest,
} from "@/application/ports/keyword-metrics-gateway";

/** Fixture {@link KeywordMetricsGateway} — returns whatever it was constructed with. */
export class FakeKeywordMetricsGateway implements KeywordMetricsGateway {
  readonly requests: KeywordMetricsRequest[] = [];

  constructor(private readonly metrics: KeywordMetric[] = []) {}

  async fetchMetrics(request: KeywordMetricsRequest): Promise<KeywordMetric[]> {
    this.requests.push(request);
    return this.metrics;
  }
}
