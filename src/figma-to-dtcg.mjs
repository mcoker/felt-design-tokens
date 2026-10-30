const FIGMA_API = 'https://api.figma.com/v1';

const TYPE_MAP = {
  BOOLEAN: 'boolean',
  COLOR: 'color',
  FLOAT: 'number',
  STRING: 'string',
  TIMING: 'duration',
  EASING: 'easing'
};

export async function fetchFigmaVariables({ fileKey, token, tokenType = 'personal' }) {
  if (!fileKey) throw new Error('A Figma file key is required.');
  if (!token) throw new Error('A Figma token is required.');

  const headers = tokenType === 'oauth'
    ? { Authorization: `Bearer ${token}` }
    : { 'X-Figma-Token': token };
  const response = await fetch(`${FIGMA_API}/files/${encodeURIComponent(fileKey)}/variables/local`, { headers });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Figma API request failed (${response.status}): ${detail}`);
  }
  return response.json();
}

/**
 * Convert a Figma variables response into the native exporter layout:
 * <collection>/<mode>.tokens.json, with each file containing only that
 * collection's token tree for the selected mode.
 */
export function figmaVariablesToNativeExports(response, { mode } = {}) {
  const data = response.meta ?? response;
  const collections = data.variableCollections ?? {};
  const variables = Object.values(data.variables ?? {});
  const variablesById = new Map();
  for (const variable of variables) {
    variablesById.set(variable.id, variable);
    if (variable.key) variablesById.set(`VariableID:${variable.key}/-1:-1`, variable);
  }
  const outputFiles = [];

  for (const collection of Object.values(collections)) {
    if (collection.remote || collection.name === 'Figma-only') continue;

    const baseCollection = collections[collection.baseCollectionId] ?? collection;
    const collectionVariables = variables.filter(
      (variable) => variable.variableCollectionId === baseCollection.id && !variable.deletedButReferenced
    );
    const exportedIds = new Set(collectionVariables.map((variable) => variable.id));
    const modes = collection.modes ?? [];

    for (const selectedMode of modes) {
      if (mode && selectedMode.name !== mode && selectedMode.modeId !== mode) continue;
      const baseModeId = selectedMode.parentModeId ?? selectedMode.modeId;
      const baseMode = baseCollection.modes?.find((item) => item.modeId === baseModeId);
      const context = {
        collection,
        baseCollection,
        mode: selectedMode,
        baseModeId,
        baseModeName: baseMode?.name ?? selectedMode.name
      };
      const tokenTree = {};
      const referenceTokens = new Set();

      for (const variable of collectionVariables) {
        const overrideModes = collection.variableOverrides?.[variable.id];
        const isOverride = overrideModes && Object.hasOwn(overrideModes, selectedMode.modeId);
        const rawValue = isOverride
          ? overrideModes[selectedMode.modeId]
          : variable.valuesByMode?.[baseModeId] ?? variable.valuesByMode?.[selectedMode.modeId];
        if (rawValue === undefined) {
          throw new Error(`Missing value for "${variable.name}" in "${collection.name}/${selectedMode.name}".`);
        }
        // Resolve the selected mode (including extension overrides), even
        // though Figma's native export sometimes uses the default mode for
        // composed color $values in extended collections.
        const token = createNativeToken(variable, rawValue, context, {
          variablesById,
          collections,
          isOverride: Boolean(isOverride),
          baseCollectionId: baseCollection.id,
          exportedIds
        });
        if (isVariableAlias(rawValue) && exportedIds.has(variablesById.get(rawValue.id)?.id)) {
          referenceTokens.add(token);
        }
        setNativePath(tokenTree, variable.name.split('/').filter(Boolean), token);
      }

      validateNativeReferences(tokenTree, referenceTokens, collection.name, selectedMode.name);

      const rootExtensions = { 'com.figma.modeName': selectedMode.name };
      if (collection.isExtension) {
        const parentCollection = collections[collection.parentVariableCollectionId];
        if (collection.parentVariableCollectionId) {
          rootExtensions['com.figma.parentVariableSetId'] = collection.parentVariableCollectionId;
        }
        if (parentCollection?.name) {
          rootExtensions['com.figma.parentVariableSetName'] = parentCollection.name;
        }
      }
      tokenTree.$extensions = rootExtensions;

      outputFiles.push({
        collectionName: collection.name,
        modeName: selectedMode.name,
        fileName: `${collection.name}/${selectedMode.name}.tokens.json`,
        tokens: tokenTree
      });
    }
  }

  if (mode && !outputFiles.length) throw new Error(`No local collection has a mode named or identified by "${mode}".`);

  return outputFiles;
}

function createNativeToken(variable, rawValue, context, resolution) {
  const type = TYPE_MAP[resolvedType(variable)];
  if (!type) throw new Error(`Unsupported Figma variable type "${resolvedType(variable)}" for "${variable.name}".`);
  const extensions = { 'com.figma.variableId': variable.id };
  if (variable.hiddenFromPublishing) extensions['com.figma.hiddenFromPublishing'] = true;
  if (variable.scopes?.length) {
    extensions['com.figma.scopes'] = variable.scopes.map((scope) => scope === 'STROKE_COLOR' ? 'STROKE' : scope);
  }
  if (resolvedType(variable) === 'STRING') extensions['com.figma.type'] = 'string';

  let value;
  if (isComposedColor(rawValue)) {
    value = resolveComposedColor(rawValue, context, resolution);
    extensions['com.figma.composedColor'] = {
      colorArg: nativeComposedArgument(rawValue.color, resolution, resolution.baseCollectionId),
      opacityArg: nativeComposedArgument(rawValue.opacity, resolution, resolution.baseCollectionId)
    };
  } else if (isVariableAlias(rawValue)) {
    const target = resolution.variablesById.get(rawValue.id);
    if (target && resolution.exportedIds.has(target.id)) {
      value = `{${target.name.split('/').join('.')}}`;
    } else {
      const resolved = resolveAliasValue(rawValue.id, context, resolution);
      if (resolved === undefined) throw new Error(`Cannot resolve alias "${rawValue.id}" for "${variable.name}".`);
      value = formatNativeValue(type, resolved);
      extensions['com.figma.aliasData'] = nativeAliasData(rawValue.id, resolution);
    }
  } else {
    value = formatNativeValue(type, rawValue);
  }

  if (context.collection.variableOverrides?.[variable.id]?.[context.mode.modeId] !== undefined) {
    extensions['com.figma.isOverride'] = true;
  }

  const token = { $type: type, $value: value };
  if (variable.description) token.$description = decodeFigmaDescription(variable.description);
  token.$extensions = extensions;
  return token;
}

function decodeFigmaDescription(description) {
  return description
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function isVariableAlias(value) {
  return value?.type === 'VARIABLE_ALIAS' && typeof value.id === 'string';
}

function isComposedColor(value) {
  return value && typeof value === 'object' && ('color' in value || 'opacity' in value);
}

function resolveComposedColor(value, context, resolution) {
  let color = isComposedColor(value) ? value.color : value;
  const opacityValue = isComposedColor(value) ? value.opacity : undefined;
  if (isVariableAlias(color)) {
    color = resolveAliasValue(color.id, context, resolution);
    if (color === undefined) throw new Error(`Cannot resolve composed color alias "${value.color.id}".`);
  }
  let opacity = opacityValue;
  if (isVariableAlias(opacityValue)) opacity = resolveAliasValue(opacityValue.id, context, resolution);
  if (isVariableAlias(opacityValue) && opacity === undefined) {
    throw new Error(`Cannot resolve composed opacity alias "${opacityValue.id}".`);
  }
  if (!color || typeof color !== 'object' || !['r', 'g', 'b'].every((channel) => typeof color[channel] === 'number') || typeof opacity !== 'number') {
    throw new Error('A composed color must resolve to RGB components and numeric opacity.');
  }
  color = { ...color, a: Math.fround(opacity / 100) };
  return formatNativeValue('color', color);
}

function nativeComposedArgument(value, resolution, baseCollectionId) {
  if (isVariableAlias(value)) {
    return { type: 'alias', alias: nativeAliasData(value.id, resolution, baseCollectionId) };
  }
  if (typeof value === 'number') return { type: 'number', value };
  return { type: typeof value, value };
}

function nativeAliasData(variableId, { variablesById, collections }, baseCollectionId) {
  const variable = variablesById.get(variableId);
  if (!variable) return { targetVariableName: variableId };
  const collection = collections[variable.variableCollectionId];
  if (variable.variableCollectionId === baseCollectionId) return { targetVariableName: variable.name };
  const metadata = {};
  if (variable.key) metadata.targetVariableId = `VariableID:${variable.key}/-1:-1`;
  metadata.targetVariableName = variable.name;
  if (collection?.key) metadata.targetVariableSetId = `VariableCollectionId:${collection.key}/-1:-1`;
  if (collection?.name) metadata.targetVariableSetName = collection.name;
  return metadata;
}

function resolveAliasValue(variableId, context, resolution, seen = new Set()) {
  if (seen.has(variableId)) return undefined;
  const target = resolution.variablesById.get(variableId);
  if (!target) return undefined;
  seen.add(variableId);

  const targetCollection = resolution.collections[target.variableCollectionId];
  if (!targetCollection) return undefined;
  const targetMode = selectAliasMode(targetCollection, context);
  const override = targetCollection.id === context.baseCollection.id
    ? context.collection.variableOverrides?.[target.id]
    : undefined;
  const value = override && Object.hasOwn(override, context.mode.modeId)
    ? override[context.mode.modeId]
    : target.valuesByMode?.[targetMode?.modeId];
  if (isVariableAlias(value)) return resolveAliasValue(value.id, { ...context, baseModeName: targetMode.name }, resolution, seen);
  if (isComposedColor(value)) {
    return isVariableAlias(value.color)
      ? resolveAliasValue(value.color.id, { ...context, baseModeName: targetMode.name }, resolution, seen)
      : value.color;
  }
  return value;
}

function selectAliasMode(collection, context) {
  const modes = collection.modes ?? [];
  if (collection.id === context.baseCollection.id) {
    return modes.find((item) => item.modeId === context.baseModeId)
      ?? modes.find((item) => item.name === context.baseModeName)
      ?? modes.find((item) => item.modeId === collection.defaultModeId)
      ?? modes[0];
  }
  return modes.find((item) => item.name === context.baseModeName)
    ?? (modes.length === 1 ? modes[0] : undefined)
    ?? modes.find((item) => item.modeId === collection.defaultModeId)
    ?? modes[0];
}

function formatNativeValue(type, value) {
  if (type === 'color' && value && typeof value === 'object' && ['r', 'g', 'b'].every((channel) => channel in value)) {
    const components = [value.r, value.g, value.b];
    return {
      colorSpace: 'srgb',
      components,
      alpha: value.a ?? 1,
      hex: `#${components.map((component) => Math.round(component * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`
    };
  }
  if (type === 'duration' && typeof value === 'number') {
    return { value: Number((value * 1000).toFixed(5)), unit: 'ms' };
  }
  if (type === 'easing' && value?.bezierValues) {
    const { p1x, p1y, p2x, p2y } = value.bezierValues;
    const number = (part) => Number(part.toFixed(6)).toString();
    return `cubic-bezier(${[p1x, p1y, p2x, p2y].map(number).join(', ')})`;
  }
  return value;
}

function setNativePath(root, segments, value) {
  if (!segments.length) return;
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    if (!current[segment]) {
      current[segment] = {};
    } else if (typeof current[segment] !== 'object' || '$type' in current[segment]) {
      current[segment] = { $root: current[segment] };
    }
    current = current[segment];
  }
  const leaf = segments.at(-1);
  if (current[leaf] !== undefined) {
    if (typeof current[leaf] === 'object' && !('$type' in current[leaf]) && current[leaf].$root === undefined) {
      current[leaf].$root = value;
    }
    return;
  }
  current[leaf] = value;
}

function validateNativeReferences(root, referenceTokens, collectionName, modeName) {
  const tokens = new Map();
  function collect(node, path = []) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$extensions') continue;
      const tokenPath = [...path, key];
      if (value?.$type) tokens.set(tokenPath.join('.'), value);
      else if (value && typeof value === 'object') collect(value, tokenPath);
    }
  }
  collect(root);
  const checked = new Set();
  function visit(path, visiting = new Set()) {
    if (checked.has(path)) return;
    if (visiting.has(path)) throw new Error(`Circular token reference in "${collectionName}/${modeName}": ${[...visiting, path].join(' -> ')}`);
    const token = tokens.get(path);
    if (!token) throw new Error(`Missing token reference "${path}" in "${collectionName}/${modeName}".`);
    const reference = referenceTokens.has(token) && /^\{([^{}]+)\}$/.exec(token.$value);
    if (reference) {
      // A variable may be both a token and a group. Refer to its $root token.
      const target = tokens.has(reference[1]) ? reference[1] : `${reference[1]}.$root`;
      if (tokens.has(target) && target !== reference[1]) token.$value = `{${target}}`;
      visiting.add(path);
      visit(target, visiting);
      visiting.delete(path);
    }
    checked.add(path);
  }
  for (const path of tokens.keys()) visit(path);
}

function resolvedType(variable) {
  return variable.resolvedType ?? variable.type;
}
