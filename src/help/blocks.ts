// The block list that the docs renderer writes and the help page draws. Plain data, so no HTML crosses the build.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "code_block"; text: string };
