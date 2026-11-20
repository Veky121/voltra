import js from '@eslint/js';
import {defineConfig} from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {ignores: ['dist/**', 'node_modules/**']},
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {ecmaVersion: 2022, sourceType: 'module', globals: globals.browser},
    plugins: {'react-hooks': reactHooks},
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // Effects here run on deliberately chosen inputs; adding the reported deps changes when they run. Review per hook.
      'react-hooks/exhaustive-deps': 'off',
      // API responses default to unknown; the any that is left is free-form admin records and socket parsing.
      '@typescript-eslint/no-explicit-any': 'off',
      // tsc enforces this with noUnusedLocals and noUnusedParameters.
      '@typescript-eslint/no-unused-vars': 'off',
      // Console output and input validation match terminal escapes and control characters on purpose.
      'no-control-regex': 'off',
      // Storage and locale probes ignore failures on purpose.
      'no-empty': ['error', {allowEmptyCatch: true}],
    },
  },
  {
    // Build plugins and Vite configuration run in Node.
    files: ['build/**/*.ts', 'vite*.ts', 'eslint.config.js'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {ecmaVersion: 2022, sourceType: 'module', globals: globals.node},
  },
  // Formatting belongs to Prettier; this turns off the rules that would disagree with it.
  prettier
);
