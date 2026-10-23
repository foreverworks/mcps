/** The throttle and the nomenclature cache, on a fake clock. */
import { describe, expect, it } from "vitest";

import { makeNomenclatureCache } from "../src/app/nomenclatureCache.js";
import { makeThrottle } from "@foreverworks/mcp-kit";

import { ISSUING } from "../src/infra/http/throttle.js";
import { oblioStub } from "./helpers.js";

const fakeClock = () => {
  let t = 0;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    slept,
  };
};

describe("the issuing throttle", () => {
  it("lets a burst of 10 through, then paces the rest so no 100 s holds more than 30", async () => {
    const clock = fakeClock();
    const throttle = makeThrottle(ISSUING, clock);
    const starts: number[] = [];
    for (let i = 0; i < 40; i += 1) await throttle(async () => starts.push(clock.now()));
    expect(starts.slice(0, 10).every((t) => t === 0)).toBe(true);
    const windowMax = Math.max(...starts.map((s) => starts.filter((t) => t >= s && t < s + 100_000).length));
    expect(windowMax).toBeLessThanOrEqual(30);
  });

  it("serves callers in the order they arrived", async () => {
    const clock = fakeClock();
    const throttle = makeThrottle({ ratePerSec: 1, burst: 1 }, clock);
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => throttle(async () => order.push(n))));
    expect(order).toEqual([1, 2, 3]);
  });
});

describe("the nomenclature cache", () => {
  const counting = () => {
    const loads = { companies: 0, series: 0, vat: 0 };
    const oblio = oblioStub({
      listCompanies: async () => {
        loads.companies += 1;
        return [];
      },
      listSeries: async () => {
        loads.series += 1;
        return [];
      },
      listVatRates: async () => {
        loads.vat += 1;
        return [];
      },
    });
    return { oblio, loads };
  };

  it("answers from memory for ten minutes, with the time it was read", async () => {
    const clock = fakeClock();
    const { oblio, loads } = counting();
    const cache = makeNomenclatureCache(oblio, 600_000, clock.now);
    await cache.series("RO1");
    clock.advance(599_999);
    await expect(cache.series("RO1")).resolves.toEqual({ value: [], asOf: 0 });
    clock.advance(1);
    await expect(cache.series("RO1")).resolves.toEqual({ value: [], asOf: 600_000 });
    expect(loads.series).toBe(2);
  });

  it("shares one load between concurrent callers", async () => {
    const { oblio, loads } = counting();
    const cache = makeNomenclatureCache(oblio, 600_000, () => 0);
    await Promise.all([cache.companies(), cache.companies()]);
    expect(loads.companies).toBe(1);
  });

  it("forgets a failed load at once instead of serving the failure", async () => {
    let calls = 0;
    const cache = makeNomenclatureCache(
      oblioStub({
        listVatRates: async () => {
          calls += 1;
          if (calls === 1) throw new Error("down");
          return [];
        },
      }),
      600_000,
      () => 0,
    );
    await expect(cache.vatRates("RO1")).rejects.toThrow("down");
    await expect(cache.vatRates("RO1")).resolves.toMatchObject({ value: [] });
  });

  it("forgets the series, and only the series, after a write", async () => {
    const { oblio, loads } = counting();
    const cache = makeNomenclatureCache(oblio, 600_000, () => 0);
    await cache.series("RO1");
    await cache.vatRates("RO1");
    cache.forgetSeries();
    await cache.series("RO1");
    await cache.vatRates("RO1");
    expect(loads).toEqual({ companies: 0, series: 2, vat: 1 });
  });
});
