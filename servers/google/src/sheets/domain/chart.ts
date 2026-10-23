import { fail, inputError } from "./errors.js";
import type { GridRangeOut, SheetsRequest } from "./schema.js";

export const CHART_TYPES = ["BAR", "COLUMN", "LINE", "PIE", "SCATTER", "AREA"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export type ChartInput = {
  readonly type: ChartType;
  /** The data, with explicit columns: the first is the domain (x axis, pie labels). */
  readonly data: GridRangeOut;
  /** Series columns (0-based); by default every column of the data after the first. */
  readonly seriesColumns?: readonly number[];
  readonly anchor: { readonly sheetId: number; readonly rowIndex: number; readonly columnIndex: number };
  readonly title: string;
  /** Whether the data's first row names the series. */
  readonly headers: boolean;
};

const column = (data: GridRangeOut, index: number): GridRangeOut => ({ ...data, startColumnIndex: index, endColumnIndex: index + 1 });

/**
 * One addChart request: series by column, the first column as the domain.
 * A bar chart's series run along the bottom axis and every other basic chart's
 * along the left, which is how the API tells a bar from a column chart.
 */
export const chartRequest = (input: ChartInput): SheetsRequest => {
  const first = input.data.startColumnIndex;
  const end = input.data.endColumnIndex;
  if (first == null || end == null) return fail(inputError("the data range needs its columns, e.g. A1:C20 or A:C"));
  const series = input.seriesColumns ?? Array.from({ length: end - first - 1 }, (_, i) => first + 1 + i);
  if (series.length === 0) return fail(inputError("a chart needs a domain column and at least one series column"));
  const position = { overlayPosition: { anchorCell: input.anchor } };
  if (input.type === "PIE") {
    if (series.length > 1) return fail(inputError("a pie chart takes one series column"));
    return {
      addChart: {
        chart: {
          position,
          spec: {
            title: input.title,
            pieChart: {
              legendPosition: "RIGHT_LEGEND",
              domain: { sourceRange: { sources: [column(input.data, first)] } },
              series: { sourceRange: { sources: [column(input.data, series[0] as number)] } },
            },
          },
        },
      },
    };
  }
  const axis = input.type === "BAR" ? "BOTTOM_AXIS" : "LEFT_AXIS";
  return {
    addChart: {
      chart: {
        position,
        spec: {
          title: input.title,
          basicChart: {
            chartType: input.type,
            legendPosition: "BOTTOM_LEGEND",
            headerCount: input.headers ? 1 : 0,
            domains: [{ domain: { sourceRange: { sources: [column(input.data, first)] } } }],
            series: series.map((c) => ({ series: { sourceRange: { sources: [column(input.data, c)] } }, targetAxis: axis })),
          },
        },
      },
    },
  };
};
