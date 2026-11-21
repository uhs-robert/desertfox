# theme

Themes as role colors. A theme file maps its colors onto a fixed list of roles, and the extension turns the stored theme into CSS for each surface. Pure code, shared by the extension and `tools/build-config`. See [`../README.md`](../README.md) for how the folder fits in `shared/`.

- `roles.ts`: the public role list. Adding a role is safe, renaming one breaks contributed themes.
- `derive.ts`: the one table of what a missing role becomes.
- `theme_file.ts`: checks one parsed theme file and fills it into a full theme. `just themes` and `tools/build-config` both use it, so they report the same errors.
- `base16.ts`: reads a base16 or base24 scheme and maps its slots onto the roles.
- `contrast.ts`: the fg_dim contrast clamp, shared by the Oasis build and the base16 importer.
- `tokens.ts`: the CSS custom property name of each role.
- `font_family.ts`: checks a font family list typed into a setting and returns canonical CSS text. It is the only guard before the value reaches a style sheet.
- `load.ts`: finds the theme a `theme` name stands for. The background, the command definitions, `config_build` and `tools/build-config` import it. No page or content bundle does, because it holds every theme table.
- `apply.ts`: turns the stored theme into CSS for one surface and keeps it current. It runs in pages and lazy content bundles, never in `content.js`.
