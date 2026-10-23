# Tokvilo navigation and readability iteration — 2026-10-23

## Problem and resulting behavior

The model market displayed hundreds of cards in one continuous page, while much of the navigation and metadata used 8–13px type. Increasing browser zoom did not solve the underlying discovery and layout problems.

- The desktop model market now has a sticky manufacturer/family sidebar with logos and counts. The sidebar scrolls within the viewport; the results use ordinary page scrolling.
- The initial view presents model families. Selecting a family shows its versions side by side. Both family and model results are limited to 12 items per page, with range, total, previous/next and direct page selection. Search and list view show bounded model results directly.
- Filters reset to page one. Model-market URLs preserve page and filter state through browser Back/Forward and language changes. Selecting a sidebar entry or another page focuses and scrolls to the results; a visible back link returns to the manufacturer's families.
- On small screens, the model sidebar becomes a collapsible chooser. Pricing uses a native manufacturer selector, avoiding a long horizontal row of tiny targets.
- Pricing has the same manufacturer/family structure and 12-model pagination. Model-specific dialogs retain all rates and conditions without pagination. Input/output previews, units, billing status and exact service routes are unchanged.
- Body text, form fields and primary controls use 16px or more; supporting copy and code use at least 14px. Model titles are 22px and family cards 24px. Both themes use stronger secondary text contrast. Headers, cards, forms, docs and workbenches reflow to accommodate the larger text.
- Public navigation marks the current page; long English console labels wrap. The wallet now follows the website's theme instead of combining white fallback panels with light text.

Chinese and English use the same layout and type scale. All existing catalogue identities remain reachable; pagination does not remove or merge services. This iteration does not change prices, billing, authentication, payment or fulfillment behavior.

## Verification boundary

Regression tests traverse all family/model pages and compare the recovered service:model identities against the complete fixture catalogue. They also cover filter resets, page bounds, history restoration, focus behavior, and full-rate dialogs.

The browser tool rejected both tab access and browser inventory before contacting a page. Resetting the tool session did not restore access. No explicit browser/computer-disable setting was found in the local Codex configuration, so the error is not attributed to the user's visible setting. Browser interaction and screenshot acceptance for this release remain unverified; no shell browser or alternative control channel was used.

Build, test and production readback results are recorded below after release. No paid model call, payment, inquiry or credential change is part of this iteration.

## Released verification

- Cloudflare `eco-geo-api` version `0939a214-78c4-44b6-b0ba-58f14ec34151` was published at `2026-10-23T06:50:44.788272Z` and read back at 100% traffic.
- All **462 tests**, production build, ESLint, TypeScript and diff checks passed.
- At `2026-10-23T06:51:03.950Z`, six Chinese/English model, pricing and product routes returned HTTP 200. The server-rendered market overview contains exactly 12 family cards and the sidebar. Current navigation state is marked in the response.
- 4 production CSS/JavaScript assets matched the local build byte for byte, including model market, price table and public navigation code. The live catalogue and pricing retained **337 service entries** each. Public prices contain no internal source-rate fields.
- PostCSS parsed all eight relevant customer style sheets. No explicit font declaration below 14px remains in those sheets. Secondary text contrast against the declared page/panel/hover backgrounds is at least 7.0:1 in dark mode and 5.3:1 in light mode; these are color calculations, not browser screenshot acceptance.
- Browser/screenshot acceptance remains unverified for the reason recorded above. No payment or model-generation request was submitted.
