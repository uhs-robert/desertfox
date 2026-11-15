# Build instructions

These steps build the extension files from this source archive, with Node and npm only. They need no other tool.

## Needs

- Node 24 and npm (npm 11 comes with it).
- Linux or macOS. The build was made on Linux.

## Steps

Run these in the folder that holds this file.

```bash
npm ci
node tools/release_stamp.mjs "$(node -p "require('./src/manifest.json').version")"
npm run build
```

The built extension is `dist/`. The submitted package is `dist/` without the `*.map` files, which hold source maps for local debugging.

## What each step does

- `npm ci` installs the exact dependencies of `package-lock.json`.
- `node tools/release_stamp.mjs <version>` copies the native host scripts from `host/` into `release-assets/` and writes the version into them. It writes the SHA-256 hash of each script to `release-assets/host_sha256.json`. The build copies that file to `dist/host_sha256.json`, which the add-on uses to check a host before it updates it. Without this step the build has no `dist/host_sha256.json`.
- `npm run build` typechecks with TypeScript, then bundles and minifies each script with esbuild (`tools/build.mjs`). The theme colors are compiled into `src/shared/themes.ts`, which is committed. The build also writes `dist/commands.json` from the command registry.

## Source and minified files

Every file in `dist/` comes from `src/`, `themes/`, `docs/`, `examples/` and `release-assets/` (from the stamp step) in this archive. The only minified or bundled files are the esbuild bundles (`background.js`, `content.js`, `hints.js` and the page bundles). No file is copied in from outside the archive except the packages that `npm ci` installs.

## The native host

The scripts in `host/` are not part of the extension package. They are the optional Linux helper that a user installs by hand. Only their hashes ship in `dist/host_sha256.json`.
