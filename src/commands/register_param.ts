import type { ParamDef } from "../shared/index.ts";
import { REGISTER_NAME_PATTERN } from "../shared/register_names.ts";

// The register a `"<reg>` typed before a key fills. The matcher fills it only for a step whose command has a param of this name.
// Optional, so a command that gets no register reads "" and the clipboard or the unnamed register stays the default.
export const REGISTER_PARAM: ParamDef = {
  name: "register",
  type: "string",
  optional: true,
  values: { from: "registers" },
  pattern: REGISTER_NAME_PATTERN,
};

export const YANK_REGISTER_PARAM: ParamDef = { ...REGISTER_PARAM, description: "Also store the text in this register." };
export const OPEN_REGISTER_PARAM: ParamDef = { ...REGISTER_PARAM, description: "Read this register instead of the clipboard." };
