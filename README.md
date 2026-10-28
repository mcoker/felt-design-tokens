# Felt design tokens
Design tokens for the Felt design system

## Export Figma variables as DTCG JSON

Requires Node.js 18 or newer. The exporter uses Figma's local variables REST endpoint and writes the same per-collection, per-mode directory layout as Figma's native exporter. Set `FIGMA_TOKEN` and `FIGMA_FILE_KEY` in your environment (the key is the identifier in the Figma file URL), then run:

```sh
node bin/figma-variables-to-dtcg.mjs --output "./your/file/path"
```

Alternatively, pass credentials explicitly:

```sh
node bin/figma-variables-to-dtcg.mjs \
  --file "$FIGMA_FILE_KEY" \
  --token "$FIGMA_TOKEN" \
  --output "./your/file/path"
```

Only file-local collections are exported; remote library collections and `Figma-only` are excluded. Every mode is exported by default. Use `--mode MODE_NAME` (or a mode ID) to export only matching modes, and `--token-type oauth` for an OAuth access token. Token JSON uses Figma's native DTCG metadata and alias representation.

Run the exporter tests with:

```sh
node --test test/figma-to-dtcg.test.mjs
```
