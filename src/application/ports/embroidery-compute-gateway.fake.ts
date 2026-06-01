import {
  type ClusterRouting,
  type EmbroideryComputeGateway,
  type SampledColors,
} from "./embroidery-compute-gateway";

/**
 * FakeEmbroideryComputeGateway — a recording, no-network
 * {@link EmbroideryComputeGateway} for future pipeline tests. It never speaks
 * to the Python service; instead it records each call's arguments and returns
 * canned bytes / sampled colors so a `RunEmbroideryPipeline` use-case (a later
 * slice) can be exercised against fakes the way the other use-cases are.
 *
 * Returned values are injectable per-instance; the defaults are inert
 * placeholders (empty bytes, an empty `SampledColors`).
 */
export class FakeEmbroideryComputeGateway implements EmbroideryComputeGateway {
  readonly traceCalls: Array<{
    pngBytes: Uint8Array;
    size: string;
    colors: number;
    palette?: string[];
    extractOutline: boolean;
    routing?: ClusterRouting;
    skipIndices?: number[];
  }> = [];
  readonly convertCalls: Array<{ svgBytes: Uint8Array; size: string }> = [];
  readonly sampleColorsCalls: Array<{
    pngBytes: Uint8Array;
    n: number;
    fullRes: boolean;
    size?: string;
  }> = [];

  constructor(
    private readonly canned: {
      trace?: Uint8Array;
      convert?: Uint8Array;
      sampleColors?: SampledColors;
    } = {},
  ) {}

  async trace(
    pngBytes: Uint8Array,
    size: string,
    colors: number,
    palette?: string[],
    extractOutline: boolean = true,
    routing?: ClusterRouting,
    skipIndices?: number[],
  ): Promise<Uint8Array> {
    this.traceCalls.push({
      pngBytes,
      size,
      colors,
      palette,
      extractOutline,
      routing,
      skipIndices,
    });
    return this.canned.trace ?? new Uint8Array();
  }

  async convert(svgBytes: Uint8Array, size: string): Promise<Uint8Array> {
    this.convertCalls.push({ svgBytes, size });
    return this.canned.convert ?? new Uint8Array();
  }

  async sampleColors(
    pngBytes: Uint8Array,
    n: number = 20,
    fullRes: boolean = false,
    size?: string,
  ): Promise<SampledColors> {
    this.sampleColorsCalls.push({ pngBytes, n, fullRes, size });
    return (
      this.canned.sampleColors ?? {
        colors: [],
        total_pixels: 0,
        total_distinct_colors: 0,
        cluster_spread: 0,
      }
    );
  }
}
