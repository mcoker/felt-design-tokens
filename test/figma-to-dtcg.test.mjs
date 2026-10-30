import test from 'node:test';
import assert from 'node:assert/strict';
import { figmaVariablesToNativeExports } from '../src/figma-to-dtcg.mjs';

test('writes native-style DTCG files per local collection mode', () => {
  const files = figmaVariablesToNativeExports({
    meta: {
      variableCollections: {
        colors: {
          id: 'collection:colors', name: 'Semantic colors', key: 'colors-key', remote: false,
          variableIds: ['VariableID:base', 'VariableID:alias'], defaultModeId: 'light',
          modes: [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }]
        },
        library: {
          id: 'collection:library', name: 'Library', remote: true,
          variableIds: ['VariableID:remote'], modes: [{ modeId: 'default', name: 'Default' }]
        },
        figmaOnly: {
          id: 'collection:figma-only', name: 'Figma-only', remote: false,
          variableIds: ['VariableID:internal'], modes: [{ modeId: 'default', name: 'Default' }]
        }
      },
      variables: {
        base: {
          id: 'VariableID:base', key: 'base-key', name: 'felt/color/brand',
          variableCollectionId: 'collection:colors', resolvedType: 'COLOR', scopes: ['FRAME_FILL'],
          valuesByMode: { light: { r: 1, g: 0, b: 0, a: 1 }, dark: { r: 0, g: 0, b: 0, a: 1 } }
        },
        alias: {
          id: 'VariableID:alias', key: 'alias-key', name: 'felt/color/action',
          variableCollectionId: 'collection:colors', resolvedType: 'COLOR', scopes: ['FRAME_FILL'],
          valuesByMode: {
            light: { type: 'VARIABLE_ALIAS', id: 'VariableID:base' },
            dark: { type: 'VARIABLE_ALIAS', id: 'VariableID:base' }
          }
        },
        remote: {
          id: 'VariableID:remote', name: 'remote', variableCollectionId: 'collection:library',
          resolvedType: 'STRING', valuesByMode: { default: 'not exported' }
        },
        internal: {
          id: 'VariableID:internal', name: 'internal', variableCollectionId: 'collection:figma-only',
          resolvedType: 'STRING', valuesByMode: { default: 'not exported' }
        }
      }
    }
  });

  assert.deepEqual(files.map(({ fileName }) => fileName), [
    'Semantic colors/Light.tokens.json',
    'Semantic colors/Dark.tokens.json'
  ]);
  assert.deepEqual(files[0].tokens.felt.color.brand.$value, {
    colorSpace: 'srgb', components: [1, 0, 0], alpha: 1, hex: '#FF0000'
  });
  assert.equal(files[0].tokens.felt.color.action.$value, '{felt.color.brand}');
  assert.deepEqual(Object.keys(files[0].tokens.felt.color.action.$extensions), [
    'com.figma.variableId', 'com.figma.scopes'
  ]);
});

test('preserves extended collection metadata and DTCG group root tokens', () => {
  const file = figmaVariablesToNativeExports({
    meta: {
      variableCollections: {
        base: {
          id: 'base', name: 'Semantic colors', key: 'base-key', remote: false,
          variableIds: ['VariableID:root', 'VariableID:child'], modes: [{ modeId: 'light', name: 'Light' }]
        },
        extension: {
          id: 'extension', name: 'Glass colors', key: 'extension-key', remote: false,
          isExtension: true, baseCollectionId: 'base', parentVariableCollectionId: 'base',
          modes: [{ modeId: 'glass-light', name: 'Light', parentModeId: 'light' }],
          variableOverrides: { 'VariableID:root': { 'glass-light': { type: 'VARIABLE_ALIAS', id: 'VariableID:child' } } }
        }
      },
      variables: {
        root: {
          id: 'VariableID:root', name: 'felt/color/focus', variableCollectionId: 'base', resolvedType: 'COLOR',
          valuesByMode: { light: { r: 1, g: 0, b: 0, a: 1 } }
        },
        child: {
          id: 'VariableID:child', name: 'felt/color/focus/ring', variableCollectionId: 'base', resolvedType: 'COLOR',
          valuesByMode: { light: { r: 0, g: 0, b: 1, a: 1 } }
        }
      }
    }
  }).find(({ fileName }) => fileName === 'Glass colors/Light.tokens.json');

  assert.deepEqual(file.tokens.felt.color.focus.$root, {
    $type: 'color', $value: '{felt.color.focus.ring}',
    $extensions: { 'com.figma.variableId': 'VariableID:root', 'com.figma.isOverride': true }
  });
  assert.deepEqual(file.tokens.$extensions, {
    'com.figma.modeName': 'Light',
    'com.figma.parentVariableSetId': 'base',
    'com.figma.parentVariableSetName': 'Semantic colors'
  });
});

test('keeps the first API variable when names collide', () => {
  const [file] = figmaVariablesToNativeExports({
    meta: {
      variableCollections: {
        collection: {
          id: 'collection', name: 'Primitives', remote: false,
          variableIds: ['VariableID:second', 'VariableID:first'],
          modes: [{ modeId: 'value', name: 'Value' }]
        }
      },
      variables: {
        first: { id: 'VariableID:first', key: 'a-key', name: 'felt/effect/size/55', variableCollectionId: 'collection', resolvedType: 'FLOAT', valuesByMode: { value: 1 } },
        second: { id: 'VariableID:second', key: 'z-key', name: 'felt/effect/size/55', variableCollectionId: 'collection', resolvedType: 'FLOAT', valuesByMode: { value: 2 } }
      }
    }
  });

  assert.equal(file.tokens.felt.effect.size['55'].$value, 1);
  assert.equal(file.tokens.felt.effect.size['55'].$extensions['com.figma.variableId'], 'VariableID:first');
});

test('does not sort variables to match Figma native export order', () => {
  const [file] = figmaVariablesToNativeExports({
    meta: {
      variableCollections: {
        local: {
          id: 'local', name: 'Local', variableIds: ['VariableID:a', 'VariableID:z'],
          modes: [{ modeId: 'default', name: 'Default' }]
        },
        external: {
          id: 'external', name: 'External', key: 'external-key', remote: true,
          modes: [{ modeId: 'default', name: 'Default' }]
        }
      },
      variables: {
        z: {
          id: 'VariableID:z', name: 'group/z', variableCollectionId: 'local', resolvedType: 'FLOAT',
          valuesByMode: { default: { type: 'VARIABLE_ALIAS', id: 'VariableID:external' } }
        },
        a: {
          id: 'VariableID:a', name: 'group/a', variableCollectionId: 'local', resolvedType: 'FLOAT',
          valuesByMode: { default: 2 }
        },
        external: {
          id: 'VariableID:external', key: 'external-key', name: 'external/value',
          variableCollectionId: 'external', resolvedType: 'FLOAT', valuesByMode: { default: 1 }
        }
      }
    }
  });

  assert.deepEqual(Object.keys(file.tokens.group), ['z', 'a']);
  assert.deepEqual(Object.keys(file.tokens.group.z.$extensions['com.figma.aliasData']), [
    'targetVariableId', 'targetVariableName', 'targetVariableSetId', 'targetVariableSetName'
  ]);
});

test('rejects missing values, unresolved aliases and circular local references', () => {
  const response = {
    variableCollections: {
      colors: { id: 'colors', name: 'Colors', modes: [{ modeId: 'dark', name: 'Dark' }] }
    },
    variables: {
      a: { id: 'a', name: 'a', variableCollectionId: 'colors', resolvedType: 'COLOR', valuesByMode: {} }
    }
  };
  assert.throws(() => figmaVariablesToNativeExports(response), /Missing value.*Colors\/Dark/);
  response.variables.a.valuesByMode.dark = { type: 'VARIABLE_ALIAS', id: 'missing' };
  assert.throws(() => figmaVariablesToNativeExports(response), /Cannot resolve alias "missing"/);
  response.variables.a.valuesByMode.dark = { type: 'VARIABLE_ALIAS', id: 'b' };
  response.variables.b = {
    id: 'b', name: 'b', variableCollectionId: 'colors', resolvedType: 'COLOR',
    valuesByMode: { dark: { type: 'VARIABLE_ALIAS', id: 'a' } }
  };
  assert.throws(() => figmaVariablesToNativeExports(response), /Circular token reference.*a -> b -> a/);
  response.variables.a.valuesByMode.dark = {
    color: { r: 1, g: 0, b: 0 }, opacity: { type: 'VARIABLE_ALIAS', id: 'missing' }
  };
  assert.throws(() => figmaVariablesToNativeExports(response), /Cannot resolve composed opacity alias "missing"/);
  response.variables.a.resolvedType = 'UNSUPPORTED';
  assert.throws(() => figmaVariablesToNativeExports(response), /Unsupported Figma variable type "UNSUPPORTED"/);
});

test('points references at $root when the target token also has children', () => {
  const [file] = figmaVariablesToNativeExports({
    variableCollections: {
      colors: { id: 'colors', name: 'Colors', modes: [{ modeId: 'one', name: 'One' }] }
    },
    variables: {
      root: { id: 'root', name: 'color/root', variableCollectionId: 'colors', resolvedType: 'COLOR', valuesByMode: { one: { r: 1, g: 0, b: 0 } } },
      child: { id: 'child', name: 'color/root/child', variableCollectionId: 'colors', resolvedType: 'COLOR', valuesByMode: { one: { r: 0, g: 0, b: 1 } } },
      alias: { id: 'alias', name: 'color/alias', variableCollectionId: 'colors', resolvedType: 'COLOR', valuesByMode: { one: { type: 'VARIABLE_ALIAS', id: 'root' } } }
    }
  });
  assert.equal(file.tokens.color.alias.$value, '{color.root.$root}');
});

test('resolves composed colors using the selected extension mode and its overrides', () => {
  const file = figmaVariablesToNativeExports({
    meta: {
      variableCollections: {
        base: {
          id: 'base', name: 'Colors', remote: false, key: 'base-key', defaultModeId: 'light',
          variableIds: ['VariableID:surface', 'VariableID:white', 'VariableID:black', 'VariableID:hover', 'VariableID:dependent'],
          modes: [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }]
        },
        extension: {
          id: 'extension', name: 'Extended colors', remote: false, isExtension: true,
          baseCollectionId: 'base', parentVariableCollectionId: 'base',
          modes: [{ modeId: 'ext-dark', name: 'Dark', parentModeId: 'dark' }],
          variableOverrides: {
            'VariableID:surface': {
              'ext-dark': {
                color: { type: 'VARIABLE_ALIAS', id: 'VariableID:black' },
                opacity: 50
              }
            }
          }
        },
        primitives: {
          id: 'primitives', name: 'Primitives', remote: true,
          modes: [{ modeId: 'value', name: 'Value' }]
        }
      },
      variables: {
        'VariableID:surface': {
          id: 'VariableID:surface', name: 'felt/color/surface', variableCollectionId: 'base', resolvedType: 'COLOR',
          valuesByMode: {
            light: { color: { type: 'VARIABLE_ALIAS', id: 'VariableID:white' }, opacity: 100 },
            dark: { color: { type: 'VARIABLE_ALIAS', id: 'VariableID:black' }, opacity: 50 }
          }
        },
        'VariableID:white': {
          id: 'VariableID:white', name: 'felt/color/white', variableCollectionId: 'base', resolvedType: 'COLOR',
          valuesByMode: { light: { r: 1, g: 1, b: 1, a: 1 }, dark: { r: 1, g: 1, b: 1, a: 1 } }
        },
        'VariableID:black': {
          id: 'VariableID:black', name: 'felt/color/black', variableCollectionId: 'base', resolvedType: 'COLOR',
          valuesByMode: { light: { r: 0, g: 0, b: 0, a: 1 }, dark: { r: 0, g: 0, b: 0, a: 1 } }
        },
        'VariableID:hover': {
          id: 'VariableID:hover', name: 'felt/color/hover', variableCollectionId: 'base', resolvedType: 'COLOR',
          valuesByMode: {
            light: { color: { type: 'VARIABLE_ALIAS', id: 'VariableID:white' }, opacity: 25 },
            dark: { color: { type: 'VARIABLE_ALIAS', id: 'VariableID:white' }, opacity: { type: 'VARIABLE_ALIAS', id: 'VariableID:opacity15' } }
          }
        },
        'VariableID:opacity15': {
          id: 'VariableID:opacity15', name: 'felt/opacity/15', variableCollectionId: 'primitives',
          resolvedType: 'FLOAT', valuesByMode: { value: 15 }
        },
        'VariableID:dependent': {
          id: 'VariableID:dependent', name: 'felt/color/dependent', variableCollectionId: 'base', resolvedType: 'COLOR',
          valuesByMode: {
            light: { color: { type: 'VARIABLE_ALIAS', id: 'VariableID:surface' }, opacity: 25 },
            dark: { color: { type: 'VARIABLE_ALIAS', id: 'VariableID:surface' }, opacity: 15 }
          }
        }
      }
    }
  }).find(({ fileName }) => fileName === 'Extended colors/Dark.tokens.json');

  const token = file.tokens.felt.color.surface;
  assert.deepEqual(token.$value, { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5, hex: '#000000' });
  assert.equal(token.$extensions['com.figma.composedColor'].colorArg.alias.targetVariableName, 'felt/color/black');
  assert.equal(token.$extensions['com.figma.isOverride'], true);
  assert.deepEqual(file.tokens.felt.color.hover.$value, {
    colorSpace: 'srgb', components: [1, 1, 1], alpha: Math.fround(0.15), hex: '#FFFFFF'
  });
  assert.equal(file.tokens.felt.color.hover.$extensions['com.figma.composedColor'].opacityArg.alias.targetVariableName, 'felt/opacity/15');
  assert.deepEqual(file.tokens.felt.color.dependent.$value, {
    colorSpace: 'srgb', components: [0, 0, 0], alpha: Math.fround(0.15), hex: '#000000'
  });
});
