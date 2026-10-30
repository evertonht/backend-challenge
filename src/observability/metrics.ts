/**
 * Minimal, dependency-free in-process metrics registry.
 *
 * Satisfies README §12 (metrics) without pulling a full SDK. Values are
 * exposed as a JSON snapshot (and optionally a /metrics endpoint in the
 * interface layer). This is a single-process registry: with N instances each
 * exports its own view, which is acceptable for the challenge's observability
 * bar (the correctness guarantees never depend on metrics).
 */

type LabelMap = Record<string, string>;

function keyOf(name: string, labels?: LabelMap): string {
  if (!labels) return name;
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return name;
  return `${name}{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
}

interface HistogramState {
  count: number;
  sum: number;
  min: number;
  max: number;
  values: number[];
}

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramState>();

  counter(name: string, labels?: LabelMap, inc = 1): void {
    const k = keyOf(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + inc);
  }

  gauge(name: string, value: number, labels?: LabelMap): void {
    this.gauges.set(keyOf(name, labels), value);
  }

  histogram(name: string, value: number, labels?: LabelMap): void {
    const k = keyOf(name, labels);
    const prev = this.histograms.get(k) ?? {
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      values: [],
    };
    const next: HistogramState = {
      count: prev.count + 1,
      sum: prev.sum + value,
      min: Math.min(prev.min, value),
      max: Math.max(prev.max, value),
      values: [...prev.values, value],
    };
    this.histograms.set(k, next);
  }

  snapshot(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, { count: number; sum: number; min: number; max: number; avg: number }>;
  } {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v;
    const gauges: Record<string, number> = {};
    for (const [k, v] of this.gauges) gauges[k] = v;
    const histograms: Record<string, { count: number; sum: number; min: number; max: number; avg: number }> = {};
    for (const [k, v] of this.histograms) {
      histograms[k] = {
        count: v.count,
        sum: v.sum,
        min: Number.isFinite(v.min) ? v.min : 0,
        max: Number.isFinite(v.max) ? v.max : 0,
        avg: v.count > 0 ? v.sum / v.count : 0,
      };
    }
    return { counters, gauges, histograms };
  }

  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}
