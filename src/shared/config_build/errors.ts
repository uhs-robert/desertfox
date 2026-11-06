// Problems are collected so one run reports every mistake in the config.
export class ConfigErrors extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`${problems.length} problem(s) in the config:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    this.problems = problems;
  }
}

export function is_plain_object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
