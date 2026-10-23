import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "target", "src-tauri", "crates"] },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // Effects here often run on purpose for one value only, such as a
      // load on mount: listing every function they call would reload more.
      "react-hooks/exhaustive-deps": "off",
      // French texts use no-break spaces before : ; ! ? and inside « ».
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true, skipJSXText: true }],
    },
  },
);
