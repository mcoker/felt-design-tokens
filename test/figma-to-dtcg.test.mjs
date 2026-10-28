import test from 'node:test';
import assert from 'node:assert/strict';
import { figmaVariablesToDtcg, figmaVariablesToNativeExports } from '../src/figma-to-dtcg.mjs';

test('converts variables, modes, colors, and aliases to DTCG', () => {
  const response = {
    variableCollections: {
      collection: {
        name: 'Colors', defaultModeId: 'light',
        modes: [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }]
      }
    },
    variables: {
      base: {
        id: 'VariableID:base', name: 'blue/500', variableCollectionId: 'collection',
        resolvedType: 'COLOR', valuesByMode: { light: { r: 0, g: 0.5, b: 1 }, dark: { r: 0.2, g: 0.6, b: 1, a: 0.8 } }
      },
      alias: {
        id: 'VariableID:alias', name: 'action/primary', variableCollectionId: 'collection',
        resolvedType: 'COLOR',
        valuesByMode: { light: { type: 'VARIABLE_ALIAS', id: 'VariableID:base' }, dark: { type: 'VARIABLE_ALIAS', id: 'VariableID:base' } }
      }
    }
  };

  const output = figmaVariablesToDtcg(response);
  assert.equal(output.Colors.blue['500'].$type, 'color');
  assert.deepEqual(output.Colors.blue['500'].$value, { colorSpace: 'srgb', components: [0, 0.5, 1], alpha: 1 });
  assert.equal(output.Colors.action.primary.$value, '{Colors.blue.500}');
  assert.equal(output.Colors.action.primary.$extensions['org.figma'].modes.Dark, '{Colors.blue.500}');
});

test('selects a named mode', () => {
  const response = {
    variableCollections: {
      collection: { name: 'Spacing', defaultModeId: 'one', modes: [{ modeId: 'one', name: 'One' }, { modeId: 'two', name: 'Two' }] }
    },
    variables: {
      space: { id: 'VariableID:space', name: 'large', variableCollectionId: 'collection', resolvedType: 'FLOAT', valuesByMode: { one: 8, two: 16 } }
    }
  };

  const output = figmaVariablesToDtcg(response, { mode: 'Two' });
  assert.equal(output.Spacing.large.$value, 16);
  assert.equal(output.Spacing.large.$type, 'number');
});

test('converts the wrapped Figma REST response', () => {
  const output = figmaVariablesToDtcg({
    status: 200,
    error: false,
    meta: {
      variableCollections: {
        collection: { name: 'Core', defaultModeId: 'default', modes: [{ modeId: 'default', name: 'Default' }] }
      },
      variables: {
        variable: { id: 'VariableID:variable', name: 'unit', variableCollectionId: 'collection', resolvedType: 'FLOAT', valuesByMode: { default: 4 } }
      }
    }
  });

  assert.equal(output.Core.unit.$value, 4);
});

test('excludes remote library collections and the Figma-only collection', () => {
  const output = figmaVariablesToDtcg({
    meta: {
      variableCollections: {
        local: { name: 'Local', remote: false, defaultModeId: 'mode', modes: [{ modeId: 'mode', name: 'Default' }] },
        library: { name: 'Library', remote: true, defaultModeId: 'mode', modes: [{ modeId: 'mode', name: 'Default' }] },
        figmaOnly: { name: 'Figma-only', remote: false, defaultModeId: 'mode', modes: [{ modeId: 'mode', name: 'Default' }] }
      },
      variables: {
        localToken: { id: 'VariableID:local', name: 'token', variableCollectionId: 'local', resolvedType: 'STRING', valuesByMode: { mode: 'local' } },
        remoteToken: { id: 'VariableID:remote', name: 'token', variableCollectionId: 'library', resolvedType: 'STRING', valuesByMode: { mode: 'remote' } },
        figmaOnlyToken: { id: 'VariableID:figma-only', name: 'token', variableCollectionId: 'figmaOnly', resolvedType: 'STRING', valuesByMode: { mode: 'internal' } }
      }
    }
  });

  assert.deepEqual(Object.keys(output), ['Local']);
  assert.equal(output.Local.token.$value, 'local');
});

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

test('keeps the first native token when names collide', () => {
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

test('matches native composed-color values and metadata for extension modes', () => {
  const file = figmaVariablesToNativeExports({
    meta: {
      variableCollections: {
        base: {
          id: 'base', name: 'Colors', remote: false, key: 'base-key', defaultModeId: 'light',
          variableIds: ['VariableID:surface', 'VariableID:white', 'VariableID:black'],
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
        }
      }
    }
  }).find(({ fileName }) => fileName === 'Extended colors/Dark.tokens.json');

  const token = file.tokens.felt.color.surface;
  assert.deepEqual(token.$value, { colorSpace: 'srgb', components: [1, 1, 1], alpha: 1, hex: '#FFFFFF' });
  assert.equal(token.$extensions['com.figma.composedColor'].colorArg.alias.targetVariableName, 'felt/color/black');
  assert.equal(token.$extensions['com.figma.isOverride'], true);
});
