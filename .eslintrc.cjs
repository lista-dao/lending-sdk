/* eslint-env node */

/**
 * Display-space values (the bStock UI multiplier) must never reach calldata.
 * The wrapper type in `src/display` is the primary guard; this rule is the
 * second one, and it covers the paths a type cannot: a `import type` used to
 * widen a parameter, and a relative import from inside the core package that
 * never names the public subpath.
 */
const BAN_MESSAGE =
  "Display-space values must never reach calldata. Use the raw amount here; convert for display at the UI boundary only.";

// `allowTypeImports: false` is set per entry, and it is the point of using the
// TypeScript-aware rule: the base rule lets `import type` through, and a type
// import is how a display value first reaches a builder's signature.
const DISPLAY_IMPORT_BAN = [
  "error",
  {
    paths: [
      {
        name: "@lista-dao/moolah-sdk-core/display",
        message: BAN_MESSAGE,
        allowTypeImports: false,
      },
    ],
    patterns: [
      {
        group: ["**/display", "**/display/*", "**/display/index.js"],
        message: BAN_MESSAGE,
        allowTypeImports: false,
      },
    ],
  },
];

module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2020, sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { node: true, es2020: true },
  ignorePatterns: ["dist", "node_modules", "*.cjs"],
  // Banned everywhere by default. An allowlist of directories was the wrong
  // shape: it silently omitted MoolahSDK.ts, the facade that calls every
  // builder, so a display value could reach an encoder through the one file
  // most likely to touch both sides.
  rules: {
    "no-restricted-imports": "off",
    "@typescript-eslint/no-restricted-imports": DISPLAY_IMPORT_BAN,
  },
  overrides: [
    {
      // The display module itself, and the tests that exercise it, are the
      // only places allowed to name it.
      files: [
        "packages/moolah-sdk-core/src/display/**/*.ts",
        "packages/*/src/__tests__/**/display*.test.ts",
        "packages/*/src/__tests__/**/liquidation.test.ts",
      ],
      rules: {
        "no-restricted-imports": "off",
        "@typescript-eslint/no-restricted-imports": "off",
      },
    },
  ],
};
