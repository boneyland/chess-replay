// ESLint: correctness only (style is Prettier's, .prettierrc.json). Run `npx eslint .` after installing the tools as
// CLAUDE.md says; GitHub Actions' lint job runs the same.
//
// The page's scripts are plain scripts, each wrapped in its own function by build.cjs (`units`), sharing values through
// `window.X = …`; the JSX files joined into game-video.jsx also share their top-level names. Both are read from the
// source here, so a new shared name needs no edit to this file.
import fs from 'node:fs';
import path from 'node:path';
import js from '@eslint/js';
import * as espree from 'espree';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const sources = (d) =>
  fs
    .readdirSync(path.join(dir, d))
    .filter((f) => /\.jsx?$/.test(f))
    .map((f) => `${d}/${f}`);
const pageFiles = [...sources('app'), ...sources('src')];
// the files that run as a Worker or the service worker, not in the page
const WORKERS = ['app/sw.js', 'app/dead-worker.js', 'app/vision-worker.js'];

// window.X = … and Object.assign(window, { … }): readable as a bare X from any unit
const shared = {};
for (const f of pageFiles) {
  const code = read(f);
  for (const m of code.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) shared[m[1]] = 'writable';
  for (const m of code.matchAll(/Object\.assign\(\s*window\s*,\s*\{([^}]*)\}/g))
    for (const p of m[1].split(',')) {
      const name = p.trim().split(/\s*:/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(name)) shared[name] = 'writable';
    }
}

// the files build.cjs joins into one unit (game-video.jsx): each sees the others' top-level declarations
const build = read('build.cjs');
const block = build.slice(build.indexOf("'game-video.jsx'"), build.lastIndexOf("'game-video.jsx'"));
const joined = [...block.matchAll(/read\(path\.join\(app, '([\w-]+\.jsx)'\)\)/g)].map((m) => `app/${m[1]}`);
if (joined.length < 2) throw new Error('eslint.config.mjs: no game-video.jsx unit found in build.cjs');
const unit = {};
const names = (p) =>
  !p
    ? []
    : p.type === 'Identifier'
      ? [p.name]
      : p.type === 'AssignmentPattern'
        ? names(p.left)
        : p.type === 'RestElement'
          ? names(p.argument)
          : p.type === 'ArrayPattern'
            ? p.elements.flatMap(names)
            : p.type === 'ObjectPattern'
              ? p.properties.flatMap((q) => names(q.value || q.argument))
              : [];
for (const f of joined)
  for (const s of espree.parse(read(f), { ecmaVersion: 2024, sourceType: 'script', ecmaFeatures: { jsx: true } })
    .body) {
    if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) unit[s.id.name] = 'writable';
    if (s.type === 'VariableDeclaration')
      for (const d of s.declarations) for (const n of names(d.id)) unit[n] = 'writable';
  }

// ESLint's own rules don't count <Foo /> as a use of Foo; this marks JSX tag names as used (eslint-plugin-react's
// jsx-uses-vars, without the dependency)
const local = {
  rules: {
    'jsx-uses-vars': {
      meta: { type: 'problem', schema: [] },
      create: (context) => ({
        JSXOpeningElement(node) {
          let n = node.name;
          while (n.type === 'JSXMemberExpression') n = n.object;
          if (n.type === 'JSXIdentifier' && /^[A-Z]/.test(n.name)) context.sourceCode.markVariableAsUsed(n.name, node);
        },
      }),
    },
  },
};

const correctness = {
  ...js.configs.recommended.rules,
  'local/jsx-uses-vars': 'error',
  'no-unused-vars': [
    'error',
    { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true },
  ],
  'no-empty': ['error', { allowEmptyCatch: true }],
  // the tests match CSS indentation literally
  'no-regex-spaces': 'off',
  // the shared names above are declared as globals and also by the file that defines them
  'no-redeclare': ['error', { builtinGlobals: false }],
  'react-hooks/rules-of-hooks': 'error',
  // an array that leaves a value out on purpose says why: // eslint-disable-next-line react-hooks/exhaustive-deps -- <why>
  'react-hooks/exhaustive-deps': 'error',
};

export default [
  {
    ignores: [
      'vendor/**',
      'babel/**',
      'openings/**',
      'vision/**',
      'out/**',
      'games/**',
      'tests/fixtures/**',
      'tests/out/**',
      'tools/**',
      '.claude/skills/**',
      'node_modules/**',
      'app/sample-analysis.js',
      'src/pieces.js',
      'src/sample-game.js',
      'src/game-data.js',
    ],
  },
  {
    files: ['app/**/*.{js,jsx}', 'src/**/*.js'],
    ignores: WORKERS,
    plugins: { 'react-hooks': reactHooks, local },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, React: 'readonly', ReactDOM: 'readonly', ...shared },
    },
    rules: correctness,
  },
  {
    // a top-level name here is usually for a sibling file, which this file can't see: check locals only
    files: joined,
    languageOptions: { globals: unit },
    rules: {
      'no-unused-vars': [
        'error',
        { vars: 'local', args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // the Workers and the service worker run apart from the page: none of its globals, no window or document
    files: WORKERS,
    plugins: { 'react-hooks': reactHooks, local },
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: globals.worker },
    rules: correctness,
  },
  {
    // build.cjs fills these placeholders in (sw.js's own comments say with what)
    files: ['app/sw.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        __LOCAL__: 'readonly',
        __REMOTE__: 'readonly',
        __KEEP_HOSTS__: 'readonly',
        __ISOLATION__: 'readonly',
      },
    },
  },
  {
    // Node scripts; the live tests also hold functions that run in the page (page.evaluate), hence the browser globals
    files: ['**/*.cjs'],
    plugins: { 'react-hooks': reactHooks, local },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser, ...shared, html2canvas: 'readonly' },
    },
    rules: correctness,
  },
];
