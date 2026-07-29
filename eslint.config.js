'use strict';

const globals = require('globals');

module.exports = [
  {
    ignores: ['.bdfl/**', 'node_modules/**', 'coverage/**', '.cache/**', 'plugins/bdfl/runtime/**']
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node
    },
    rules: {
      'no-constant-condition': 'error',
      'no-debugger': 'error',
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-irregular-whitespace': 'error',
      'no-loss-of-precision': 'error',
      'no-obj-calls': 'error',
      'no-prototype-builtins': 'error',
      'no-self-assign': 'error',
      'no-setter-return': 'error',
      'no-shadow-restricted-names': 'error',
      'no-sparse-arrays': 'error',
      'no-unexpected-multiline': 'error',
      'no-unreachable': 'error',
      'no-unreachable-loop': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-unused-labels': 'error',
      'no-unused-private-class-members': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-useless-backreference': 'error',
      'no-useless-catch': 'error',
      'no-useless-escape': 'error',
      'no-with': 'error',
      'require-yield': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error'
    }
  }
];
