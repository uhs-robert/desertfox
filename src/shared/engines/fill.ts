// Fills a URL template with the query and the page. A template holds slot expressions:
//   {name}          a slot
//   {a|b}           the first of the alternatives that has a value, for example {query|url}
//   {name:raw}      inserted as it is, with no escaping
// `%s` reads as {query}, as in Firefox keyword bookmarks.

import { slot_of } from "./slots.ts";
import type { PageInfo } from "./slots.ts";

export const SLOT_EXPRESSION = /\{([a-z_][a-z0-9_]*(?:\|[a-z_][a-z0-9_]*)*)(:raw)?\}|%s/g;

export type Expression = { alternatives: string[]; raw: boolean };
export type Piece = { literal: string } | { expression: Expression };

export function parse_template(template: string): Piece[] {
  const pieces: Piece[] = [];
  let from = 0;
  for (const found of template.matchAll(SLOT_EXPRESSION)) {
    if (found.index > from) pieces.push({ literal: template.slice(from, found.index) });
    pieces.push({ expression: { alternatives: (found[1] ?? "query").split("|"), raw: found[2] !== undefined } });
    from = found.index + found[0].length;
  }
  if (from < template.length) pieces.push({ literal: template.slice(from) });
  return pieces;
}

export const expressions_of = (template: string): Expression[] => parse_template(template).flatMap((piece) => ("expression" in piece ? [piece.expression] : []));

export const expression_text = (expression: Expression): string => expression.alternatives.join("|");

// The expressions that only the page can fill: what an engine needs from a page before it can run there.
// An expression with the query among its alternatives can always be filled by typing.
export function page_requirements(template: string): string[] {
  const needs = expressions_of(template)
    .filter((expression) => expression.alternatives.every((name) => slot_of(name)?.kind === "page"))
    .map(expression_text);
  return [...new Set(needs)];
}

export type FillInput = { query?: string; page?: PageInfo };
export type Filled = { ok: true; url: string } | { ok: false; message: string };

function value_of(name: string, input: FillInput): string | undefined {
  const slot = slot_of(name);
  if (!slot) return undefined;
  if (slot.kind === "input") return input.query;
  return input.page ? slot.read(input.page) : undefined;
}

// With alternatives, an empty query counts as not given, so the next alternative fills in.
function expression_value(expression: Expression, input: FillInput): { value: string } | { message: string } {
  const last = expression.alternatives.at(-1) ?? "query";
  const only_one = expression.alternatives.length === 1;
  for (const name of expression.alternatives) {
    const value = value_of(name, input);
    if (value !== undefined && (only_one || value !== "")) return { value };
  }
  return { message: slot_of(last)?.message ?? `Unknown slot "${last}"` };
}

// A space in the template itself (a scope like "repo:{repo} " is written with one) is escaped the same way as in a value.
const escape_literal = (text: string): string => text.replaceAll(" ", "%20");

// Every slot value is escaped for the part of the URL it lands in: path, query value or fragment. All three take
// encodeURIComponent, which keeps "/" and "&" from ending the part early. Literal text is left as the author wrote it.
export function fill_template(template: string, input: FillInput): Filled {
  let url = "";
  for (const piece of parse_template(template)) {
    if ("literal" in piece) {
      url += escape_literal(piece.literal);
      continue;
    }
    const found = expression_value(piece.expression, input);
    if ("message" in found) return { ok: false, message: found.message };
    url += piece.expression.raw ? found.value : encodeURIComponent(found.value);
  }
  return { ok: true, url };
}
