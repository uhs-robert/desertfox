// One request against one driver.

import type { QualityAnswer, QualityLevel, QualityRequest } from "../../shared/quality.ts";
import { choose_level } from "./choose_level.ts";
import type { Driver } from "./driver.ts";

const shown = (levels: readonly { label: string; height: number; active: boolean }[]): QualityLevel[] => levels.map(({ label, height, active }) => ({ label, height, active }));

export function apply_quality(driver: Driver, request: QualityRequest): QualityAnswer {
  if (request.op === "captions") return { levels: [], toggled: driver.toggle_captions?.() ?? false };
  if (request.op === "skip") return { levels: [], skipped: driver.skip(request.value !== "previous") };
  const levels = driver.levels();
  if (request.op === "list" || request.value === undefined) return { levels: shown(levels) };
  if (request.value === "auto") return { levels: shown(levels), ...(driver.auto() ? { chosen: "auto" } : {}) };
  const current = levels.findIndex((level) => level.active);
  const chosen = choose_level(levels, request.value, current < 0 ? undefined : current, request.times);
  if (!chosen) return { levels: [] };
  chosen.pick();
  return { levels: shown(levels.map((level) => ({ ...level, active: level === chosen }))), chosen: chosen.label };
}
