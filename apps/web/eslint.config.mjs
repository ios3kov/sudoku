import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    files: [
      "features/messenger/encrypted-attachment.tsx",
      "features/messenger/conversation-view.tsx",
    ],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "generated/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);
