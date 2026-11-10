# Felt design tokens

Design tokens for the Felt design system.

## Requirements

- Node.js 18 or newer. No dependencies need to be installed.
- Access to Figma's Variables REST API: Enterprise organization membership, file view access, and a token with the `file_variables:read` scope.

## Export JSON

Set your Figma token and file key (the identifier in the Figma file URL), then run the exporter:

```sh
export FIGMA_TOKEN="your-figma-token"
export FIGMA_FILE_KEY="your-file-key"

node bin/figma-variables-to-dtcg.mjs --output "./tokens/figma"
```

The exporter writes one file per local collection and mode:

```text
tokens/figma/<collection>/<mode>.tokens.json
```

Remote library collections, the `Figma-only` collection, and variables with `figma-only` anywhere in their name are excluded.

### Options

| Option | Description |
| --- | --- |
| `--output DIR` | Required output directory. |
| `--mode MODE` | Export only modes matching this name or ID. Defaults to all modes. |
| `--file FILE_KEY` | Override `FIGMA_FILE_KEY`. |
| `--token TOKEN` | Override `FIGMA_TOKEN`. Prefer the environment variable to avoid exposing the token in process arguments. |
| `--token-type personal\|oauth` | Token type. Defaults to `personal`; also configurable with `FIGMA_TOKEN_TYPE`. |

Full exports update generated files and remove obsolete files tracked by `.figma-variables-export.json`. Exports using `--mode` leave other modes in place. Files not tracked by the manifest are not removed.

## JSON format

- Variable names separated by `/` become nested token groups. Tokens use `$type` and `$value`, with descriptions and Figma metadata where available.
- Aliases to other exported tokens in the same collection remain token references; other aliases resolve to values.
- Length-scoped numbers export as `dimension` values in pixels. Other numbers, including opacity, font weight, z-index, and proportional line height, remain unitless.
- `felt/duration/*` and `felt/motion/duration/*` values are treated as seconds and exported as `duration` values in milliseconds. Ensure the source values use seconds.
- `felt/easing/*` and `felt/motion/easing/*` values export as `cubicBezier` arrays. Other duration or easing names need an explicit mapping in the exporter.
- Composed colors resolve the selected mode and its overrides, matching Figma's displayed color.

Invalid or duplicate token paths, missing values, unresolved aliases, and circular references cause the export to fail rather than write incomplete tokens.

## Tests

```sh
node --test test/*.test.mjs
```
