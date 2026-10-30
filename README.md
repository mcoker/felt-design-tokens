# Felt design tokens
Design tokens for the Felt design system

## Export Figma variables as DTCG JSON

Requires Node.js 18 or newer. The exporter uses Figma's local variables REST endpoint and writes one DTCG JSON file per local collection and mode. Set `FIGMA_TOKEN` and `FIGMA_FILE_KEY` in your environment (the key is the identifier in the Figma file URL), then run:

```sh
node bin/figma-variables-to-dtcg.mjs --output "./tokens/figma"
```

Alternatively, pass credentials explicitly:

```sh
node bin/figma-variables-to-dtcg.mjs \
  --file "$FIGMA_FILE_KEY" \
  --token "$FIGMA_TOKEN" \
  --output "./tokens/figma"
```

Only file-local collections are exported; remote library collections and `Figma-only` are excluded. Every mode is exported by default. Use `--mode MODE_NAME` (or a mode ID) to export only matching modes, and `--token-type oauth` for an OAuth access token. The files retain Figma metadata for traceability; JSON key order is not significant.

For composed colors in extended collections, `$value` resolves the selected mode and its overrides, as displayed in Figma. Figma's native JSON export can instead serialize the base collection's default-mode color while retaining the selected mode's `com.figma.composedColor` metadata; those `$value` fields will therefore differ from the native export. A missing mode value, unresolved alias, or circular token reference fails the export instead of producing incomplete tokens.

Run the exporter tests with:

```sh
node --test test/figma-to-dtcg.test.mjs
```
