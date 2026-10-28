#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchFigmaVariables, figmaVariablesToNativeExports } from '../src/figma-to-dtcg.mjs';

const args = parseArgs(process.argv.slice(2));
const fileKey = args.file ?? process.env.FIGMA_FILE_KEY;
const token = args.token ?? process.env.FIGMA_TOKEN;
const tokenType = args['token-type'] ?? process.env.FIGMA_TOKEN_TYPE ?? 'personal';
const outputDirectory = args.output;

try {
  if (!['personal', 'oauth'].includes(tokenType)) {
    throw new Error('Token type must be "personal" or "oauth".');
  }
  if (!outputDirectory) {
    throw new Error('An output directory is required. Pass --output DIR.');
  }
  const response = await fetchFigmaVariables({ fileKey, token, tokenType });
  const files = figmaVariablesToNativeExports(response, { mode: args.mode });
  const root = path.resolve(outputDirectory);
  for (const file of files) {
    const destination = path.join(root, safeName(file.collectionName), `${safeName(file.modeName)}.tokens.json`);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(file.tokens, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`Exported ${files.length} mode file${files.length === 1 ? '' : 's'} to ${root}\n`);
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--help' || value === '-h') {
      process.stdout.write('Usage: figma-variables-to-dtcg --output DIR [--file FILE_KEY] [--token TOKEN] [--mode MODE]\n');
      process.exit(0);
    }
    if (!value.startsWith('--')) throw new Error(`Unknown argument: ${value}`);
    const [key, inlineValue] = value.slice(2).split('=', 2);
    result[key] = inlineValue ?? values[++index];
  }
  return result;
}

function safeName(value) {
  return value.replace(/[\\/]/g, '-').replace(/^\.+$/, '_');
}
