const FIGMA_API = 'https://api.figma.com/v1';

const TYPE_MAP = {
  BOOLEAN: 'boolean',
  COLOR: 'color',
  FLOAT: 'number',
  STRING: 'string',
  TIMING: 'duration',
  EASING: 'easing'
};

/**
 * Convert the response from GET /files/:key/variables/local to DTCG JSON.
 * Figma variable names use slash-separated paths, which map naturally to
 * DTCG groups. Collection names are included to avoid collisions between
 * collections that contain variables with the same name.
 */
export function figmaVariablesToDtcg(response, { mode } = {}) {
  const data = response.meta ?? response;
  const collections = data.variableCollections ?? {};
  // The endpoint can include library variables as well as variables created
  // in this file. Do not export collections marked remote by Figma or the
  // file-local Figma-only collection.
  const variables = Object.values(data.variables ?? {}).filter(
    (variable) => {
      const collection = collections[variable.variableCollectionId];
      return collection?.remote !== true && collection?.name !== 'Figma-only';
    }
  );
  const basePaths = new Map();
  const pathCounts = new Map();
  const variablePaths = new Map();

  for (const variable of variables) {
    const collection = collections[variable.variableCollectionId];
    const path = [collection?.name, ...variable.name.split('/')]
      .filter(Boolean)
      .map(normalizePathSegment);
    const basePath = path.join('.');
    basePaths.set(variable.id, path);
    pathCounts.set(basePath, (pathCounts.get(basePath) ?? 0) + 1);
  }

  for (const variable of variables) {
    const path = basePaths.get(variable.id);
    const basePath = path.join('.');
    const hasChildPath = [...basePaths.values()].some((otherPath) =>
      otherPath.length > path.length && otherPath.slice(0, path.length).every((part, index) => part === path[index])
    );
    if (pathCounts.get(basePath) > 1 || hasChildPath) {
      path[path.length - 1] = `${path.at(-1)}--${normalizePathSegment(variable.id.replace(/^VariableID:/, ''))}`;
    }
    variablePaths.set(variable.id, path);
  }

  const root = {};
  for (const variable of variables) {
    const collection = collections[variable.variableCollectionId];
    const collectionMode = selectMode(collection, mode);
    const selectedModeId = collectionMode?.modeId ?? Object.keys(variable.valuesByMode ?? {})[0];
    const unresolvedAliases = [];
    const valuesByMode = Object.fromEntries(
      Object.entries(variable.valuesByMode ?? {}).map(([modeId, value]) => {
        const name = collection?.modes?.find((item) => item.modeId === modeId)?.name ?? modeId;
        return [name, convertValue(value, variablePaths, unresolvedAliases)];
      })
    );
    const value = convertValue(variable.valuesByMode?.[selectedModeId], variablePaths, unresolvedAliases);
    const token = {
      $type: TYPE_MAP[resolvedType(variable)] ?? 'unknown',
      $value: value,
      $extensions: {
        'org.figma': {
          id: variable.id,
          collectionId: variable.variableCollectionId,
          collectionName: collection?.name,
          scopes: variable.scopes,
          hiddenFromPublishing: variable.hiddenFromPublishing,
          modes: valuesByMode,
          ...(unresolvedAliases.length ? { unresolvedAliases: [...new Set(unresolvedAliases)] } : {})
        }
      }
    };

    if (variable.description) token.$description = variable.description;
    if (variable.codeSyntax) token.$extensions['org.figma'].codeSyntax = variable.codeSyntax;
    setPath(root, variablePaths.get(variable.id), token);
  }

  return root;
}

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
    const collectionVariables = (baseCollection.variableIds ?? [])
      .map((id) => variablesById.get(id))
      .filter((variable) => variable && !variable.deletedButReferenced)
      .sort((a, b) => a.name.localeCompare(b.name) || String(a.key ?? a.id).localeCompare(String(b.key ?? b.id)));
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

      for (const variable of collectionVariables) {
        const overrideModes = collection.variableOverrides?.[variable.id];
        const isOverride = overrideModes && Object.hasOwn(overrideModes, selectedMode.modeId);
        const rawValue = isOverride
          ? overrideModes[selectedMode.modeId]
          : variable.valuesByMode?.[baseModeId] ?? variable.valuesByMode?.[selectedMode.modeId];
        // Figma's native exporter serializes extended-set composed color
        // values from the base collection's default mode, while its metadata
        // reflects the selected mode's composed color and override state.
        const valueRaw = collection.isExtension && isComposedColor(rawValue)
          ? variable.valuesByMode?.[baseCollection.defaultModeId] ?? rawValue
          : rawValue;
        const useDefaultModeForComposedColor = valueRaw !== rawValue;
        const valueContext = useDefaultModeForComposedColor
          ? {
              ...context,
              baseModeId: baseCollection.defaultModeId,
              baseModeName: baseCollection.modes?.find((item) => item.modeId === baseCollection.defaultModeId)?.name ?? context.baseModeName
            }
          : context;
        const token = createNativeToken(variable, valueRaw, valueContext, {
          variablesById,
          collections,
          isOverride: Boolean(isOverride),
          baseCollectionId: baseCollection.id,
          modeName: context.baseModeName,
          metadataValue: rawValue
        });
        setNativePath(tokenTree, variable.name.split('/').filter(Boolean), token);
      }

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
  const type = TYPE_MAP[resolvedType(variable)] ?? 'unknown';
  const extensions = { 'com.figma.variableId': variable.id };
  if (variable.hiddenFromPublishing) extensions['com.figma.hiddenFromPublishing'] = true;
  if (variable.scopes?.length) {
    extensions['com.figma.scopes'] = variable.scopes.map((scope) => scope === 'STROKE_COLOR' ? 'STROKE' : scope);
  }
  if (resolvedType(variable) === 'STRING') extensions['com.figma.type'] = 'string';

  let value;
  const metadataValue = resolution.metadataValue ?? rawValue;
  if (isComposedColor(metadataValue)) {
    value = resolveComposedColor(rawValue, context, resolution);
    extensions['com.figma.composedColor'] = {
      colorArg: nativeComposedArgument(metadataValue.color, resolution, resolution.baseCollectionId),
      opacityArg: nativeComposedArgument(metadataValue.opacity, resolution, resolution.baseCollectionId)
    };
  } else if (isVariableAlias(rawValue)) {
    const target = resolution.variablesById.get(rawValue.id);
    if (target && target.variableCollectionId === resolution.baseCollectionId) {
      value = `{${target.name.split('/').join('.')}}`;
    } else {
      value = formatNativeValue(type, resolveAliasValue(rawValue.id, context, resolution));
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
  }
  let opacity = opacityValue;
  if (isVariableAlias(opacityValue)) opacity = resolveAliasValue(opacityValue.id, context, resolution);
  if (color && typeof color === 'object' && ['r', 'g', 'b'].every((channel) => channel in color) && typeof opacity === 'number') {
    color = { ...color, a: Math.fround(opacity / 100) };
  }
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
  const metadata = { targetVariableName: variable.name };
  if (variable.variableCollectionId === baseCollectionId) return metadata;
  if (variable.key) metadata.targetVariableId = `VariableID:${variable.key}/-1:-1`;
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
  let value = target.valuesByMode?.[targetMode?.modeId];
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

function selectMode(collection, requestedMode) {
  if (!collection?.modes?.length) return undefined;
  if (!requestedMode) return collection.modes.find((item) => item.modeId === collection.defaultModeId) ?? collection.modes[0];
  return collection.modes.find((item) => item.modeId === requestedMode || item.name === requestedMode)
    ?? (() => { throw new Error(`Mode "${requestedMode}" was not found in collection "${collection.name}".`); })();
}

function resolvedType(variable) {
  return variable.resolvedType ?? variable.type;
}

function convertValue(value, variablePaths, unresolvedAliases) {
  if (value && value.type === 'VARIABLE_ALIAS') {
    const path = variablePaths.get(value.id);
    if (!path) {
      unresolvedAliases?.push(value.id);
      return `{figma.${value.id.replace(/^VariableID:/, '').replace(/[^A-Za-z0-9_-]+/g, '-') }}`;
    }
    return `{${path.join('.')}}`;
  }
  if (value && typeof value === 'object' && ['r', 'g', 'b'].every((channel) => channel in value)) {
    return { colorSpace: 'srgb', components: [value.r, value.g, value.b], alpha: value.a ?? 1 };
  }
  return value;
}

function normalizePathSegment(segment) {
  return segment.trim().replace(/\s+/g, '-').replace(/\./g, '-');
}

function setPath(root, segments, value) {
  const path = segments.map(normalizePathSegment);
  if (!path.length) throw new Error('A Figma variable must have a name.');
  let current = root;
  for (const segment of path.slice(0, -1)) {
    if (current[segment] === undefined) current[segment] = {};
    if (typeof current[segment] !== 'object' || '$value' in current[segment]) {
      throw new Error(`Token path collision at "${path.join('.')}".`);
    }
    current = current[segment];
  }
  if (current[path.at(-1)] !== undefined) {
    throw new Error(`Token path collision at "${path.join('.')}".`);
  }
  current[path.at(-1)] = value;
}
