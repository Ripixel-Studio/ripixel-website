# ripixel.co.uk

> “Why use a static site generator when you can just... y'know... write the HTML yourself?”
>
> *— Past Me, before [Skier](https://github.com/ripixel/skier)*

---

## Wait, what changed?

Once upon a time, this repo was a shrine to DIY static site generation: hand-rolled scripts, copy-pasted partials, and a stubborn refusal to use “real” tools.
But then Skier came along—minimal, modular, and just as allergic to bloat as I am. Now, all the build magic happens in [Skier](https://github.com/ripixel/skier), and this repo is just the content, templates, and a sprinkle of config.

---

## How does it work now?

- **Build pipeline?**
  All the heavy lifting is handled by Skier’s built-in tasks: pages, blog, feeds, static assets, CSS, you name it.
  The pipeline is defined in [`skier.tasks.cjs`](./skier.tasks.cjs)—open it up and you’ll see exactly what happens, in what order, and why.
- **Templates & partials?**
  Still Handlebars, still easy.
  All the HTML lives in `/pages` and `/partials`, just like before (but now with more sanity).
- **Content?**
  Markdown and HTML. That's it.
  Blog posts and other items are in `/items`
- **Assets?**
  Static files go in `/assets` and get copied over.
  CSS is bundled and minified for you.
  No more “did I forget to copy favicon.ico?” moments.

---

## Building & Deploying

- **Build:**
  `npm run build` (calls Skier, not a homegrown script)
- **Preview locally:**
  Use your favorite static server, e.g. `npx serve public`
- **Deploy:**
  Hosted on Firebase. Run `firebase deploy` (CI uses `firebase deploy --token $FIREBASE_TOKEN`).

---

## Fitness data

The `/life` fitness section is built from the FitGlue showcase export: a set of
JSON files on a public bucket (`index.json`, `activity/<slug>.json`,
`roundup/<key>.json` — the contract is in `jarvis-memory/specs/ripixel-website/fitness-zine.md`).
`tasks/fitness-fetch.mjs` runs early in the personal pipeline and exposes:

| global | shape |
|---|---|
| `fitnessIndex` | the `index.json` object (`profile`, `streaks`, `activities[]`, `roundups[]`); an empty skeleton when unavailable |
| `fitnessActivities` | full `activity/*.json` objects, newest first, each with its index entry attached as `indexEntry` |
| `fitnessRoundups` | full `roundup/*.json` objects, newest first |
| `fitnessUnavailable` | `true` when no source could be read |
| `fitnessSource` | `live` \| `cache` \| `fixtures` \| `none` |

Sources are tried in order **live → `.cache/fitness/` → `fixtures/fitness/` → empty**.
The build never fails because of fitness data; the task logs one line saying
which source it used. The live fetch writes everything it downloads into
`.cache/fitness/` (gitignored) and sends `If-None-Match` on later runs, so an
unchanged file costs a 304.

| env var | effect |
|---|---|
| `FITNESS_DATA_SOURCE=live\|cache\|fixtures` | force one source and skip the fallback chain (a forced source that fails means `fitnessUnavailable=true`). CI and preview builds should set `fixtures`. |
| `FITNESS_DATA_BASE` | base URL of the export; default `https://storage.googleapis.com/fitglue-server-prod-showcase-assets/site/james`. `FITNESS_DATA_BASE_URL` is accepted as an alias. |

- Refresh the cache from the bucket: `npm run fitness:refresh` (or just build; a normal `npm run build:personal` refreshes it too).
- Build offline from the committed sample: `FITNESS_DATA_SOURCE=fixtures npm run build:personal`.
- `fixtures/fitness/` is a copy of the S0 reference fixtures (three activities, one roundup); keep it in sync with the contract, not with the bucket.
- Tests: `npm test` (`node --test`, no extra dependencies).

Downstream tasks can page over the globals directly (`generatePaginatedItemsTask({ dataVar: '${fitnessActivities}', ... })`); no JSON needs writing to disk.

---

## Why Skier?

Because life’s too short to debug your own static site generator.
Skier is minimal, type-safe, and doesn’t try to outsmart you.
Want to see how it works? Check out [Skier on GitHub](https://github.com/ripixel/skier).

---

## License

MIT
