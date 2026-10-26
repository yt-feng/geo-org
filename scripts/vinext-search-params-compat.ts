import type { Plugin } from "vite";

// vinext 0.0.50's generated pre-render probe reads `searchParamsObject`, while
// collectAppPageSearchParams returns `pageSearchParams`. The ordinary render
// uses the correct property, so an auth redirect during the probe loses lang.
// Keep this compatibility fix scoped to that generated entry, without editing
// installed dependencies. A fixed upstream entry needs no transformation.
const entryId = "\0virtual:vinext-rsc-entry";
const brokenProperty = "__collectAppPageSearchParams(searchParams).searchParamsObject";
const correctProperty = "__collectAppPageSearchParams(searchParams).pageSearchParams";

export function vinextSearchParamsCompat(): Plugin {
  return {
    name: "tokvilo-vinext-search-params-compat",
    enforce: "pre",
    transform(code, id) {
      if (id !== entryId || !code.includes(brokenProperty)) return null;
      return { code: code.replaceAll(brokenProperty, correctProperty), map: null };
    },
  };
}
