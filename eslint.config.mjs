import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not application/test source — excluded from tsconfig too (PA-273):
    "cli/dist/**", // compiled CLI output (cli/src is the real, linted source)
    "del_archive/**", // archived dead code
    "scripts/**", // ad-hoc operational/probe scripts, not shipped
  ]),
  // A leading underscore marks a binding that exists for its position rather
  // than its value: a parameter before a used one, or a discarded key.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
    },
  },
  // A mock cast (`mockResolvedValue(fixture as any)`) protects no shipped
  // code, so `any` is off in tests and stays an error in app source.
  {
    files: ["tests/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Next's image rule targets what Next renders. A test tree is rendered by
  // Testing Library, where `next/image` is the thing being stubbed out.
  {
    files: ["tests/**"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
