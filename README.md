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
  `npm run build` builds both sites (via Skier); `npm run build:corporate` / `npm run build:personal` build one.
- **Preview locally:**
  Use your favorite static server, e.g. `npx serve public` (or `npm run serve:personal`).
- **Deploy:**
  Hosted on Firebase Hosting, two targets (`corporate` → www.ripixel.co.uk, `personal` → james.ripixel.co.uk; see `.firebaserc`).
  There is no CI: nothing deploys on merge. The box (Jarvis) deploys with
  `~/jarvis/scripts/deploy_site.sh ripixel-website [corporate|personal|all]`, which pulls `master`,
  runs `npm ci` and the build (`FITNESS_DATA_SOURCE=live` for `personal`), runs
  `firebase deploy --only hosting:<target>`, and checks the site answers 200. Releases are atomic,
  so a failed build or deploy leaves the site as it was. Docs: `jarvis/docs/deploys.md`.
- **Preview channels:**
  `deploy_site.sh ripixel-website <target> --preview` deploys the current `master` to the Firebase
  preview channel `box` (`--preview=<name>` for a named one; both expire after 7 days) and prints the URL.
  From a laptop: `npx firebase hosting:channel:deploy <name> --only <target>`.
- **Releases:**
  Versions are no longer tagged by CI. When a bump is wanted, run `npm run release`
  (`standard-version`: bumps `package.json`, writes `CHANGELOG.md`, commits and tags) and push the
  commit and tag like any other change. The `/changelog` page and its "vX.Y.Z" are rendered from
  `CHANGELOG.md` at build time, so between releases the site simply shows the last release.

---

## Fitness data

The `/life` fitness section is built from the FitGlue showcase export: a set of
JSON files on a public bucket (`index.json`, `activity/<slug>.json`,
`roundup/<key>.json`, `events.json` — the contract is in `jarvis-memory/specs/ripixel-website/fitness-zine.md`).
`tasks/fitness-fetch.mjs` runs early in the personal pipeline and exposes:

| global | shape |
|---|---|
| `fitnessIndex` | the `index.json` object (`profile`, `streaks`, `activities[]`, `roundups[]`); an empty skeleton when unavailable |
| `fitnessActivities` | full `activity/*.json` objects, newest first, each with its index entry attached as `indexEntry` |
| `fitnessRoundups` | full `roundup/*.json` objects, newest first |
| `fitnessEvents` | the `events.json` object (the Fitness calendars, see below), or `null` when the source has none |
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

`tasks/fitness-life.mjs` runs straight after the fetch and turns those globals into one
pre-formatted `fitnessLife` global for `personal/pages/life.html` — the week strip, the
latest six activity cards, the roundup teaser, the totals/streaks/PB block and the "on the
calendar" block. All formatting lives in that task (it is data, not markup); the
`fitness-*` partials only loop and test.

**Shared by the /life pages.** `tasks/fitness-theme.mjs` maps a FitGlue activity type to its
family (`run`, `ride`, `crossfit`, `strength`, `yoga`, …: FitGlue's showcase family map) and
`personal/assets/styles/main/fitness-types.css` gives each family an ink as
`.fit-type--<family>` → `var(--type)` / `var(--type-on)`; colour anything about a session with
those rather than the page's section ink. `tasks/fitness-records.mjs` turns FitGlue's raw PR
keys (`fastest_5k`, `leg_press_heaviest_weight`, `hybrid_race_hyrox_wall_balls`) into display
names and merges PR lists into the current record per key.

**On the calendar.** `events.json` in the same bucket is James's *Fitness Events* (races and
one-offs, next 120 days) and *Fitness Regular* (recurring sessions, next 21 days) Google
calendars, exported by the box (`jarvis/scripts/fitness_calendar_export.py`, every 30 min
with the site rebuild). The fetch exposes it as `fitnessEvents` (`{generatedAt, events[]}`,
each entry `calendar: events|regular`, `kind: race|other|class|session`, ISO `start`/`end`,
`allDay`, `location`, `description`); `fixtures/fitness/events.json` is the sample. The life
page shows **next up** (the next five from the events calendar, with a countdown and a
RACE/EVENT stamp — the Events calendar only, the big things) and **this week** (Monday to
Sunday: a day is *active* when an activity was actually logged on it, whatever was planned;
still-to-come entries from both calendars show as *planned*; a past day with neither is a
rest day). Past calendar entries are never shown; with nothing upcoming or logged this week
the section is omitted. The hand-written
`events` in `personal/items/life/fitness.json` are used only when `events.json` is
unavailable.

Downstream tasks can page over the globals directly (`generatePaginatedItemsTask({ dataVar: '${fitnessActivities}', ... })`); no JSON needs writing to disk.

### Pages, feed and OG images built from it

Every page and the feed are rendered by Skier builtins; the site's own tasks only shape
globals (and draw the share cards). The render configuration is `tasks/life-pages.mjs`.

| data task (custom) | global | rendered by (Skier) | output |
|---|---|---|---|
| `tasks/fitness-og-images.mjs` | `fitnessOgImages`, `fitnessShareCards` | — (sharp, see below) | `/life/share/<kind>/<id>/<shape>-<background>.(jpg\|png)` — the share cards (the landscape one is the page's OG image) and `/life/share/index.json`, their manifest |
| `tasks/fitness-activity-views.mjs` | `fitnessActivityPages` | `generateDataPagesTask` + `personal/templates/activity.html` | `/life/activity/<slug>` |
| `tasks/fitness-event-views.mjs` | `fitnessEventPages` | `generateDataPagesTask` + `personal/templates/event.html` | `/life/event/<slug>` — one page per race weekend (several races at one event within a few days) |
| `tasks/fitness-roundup-views.mjs` | `fitnessRoundupPages` | `generateDataPagesTask` + `personal/templates/roundup.html` | `/life/roundup/<key>` |
| `tasks/fitness-roundup-views.mjs` | `fitnessRoundupsIndex` | `generatePagesTask` + `personal/pages/life/roundups.html` | `/life/roundups` |
| `tasks/fitness-sessions.mjs` | `fitnessSessionsPage` | `generatePagesTask` + `personal/pages/life/sessions.html` | `/life/sessions` — every session newest first, by month, filterable by type (JS reveals 48 at a time) |
| `tasks/fitness-feed-items.mjs` | `fitnessFeedItems` | `generateFeedTask` (Atom only) | **`/life/feed.xml`** — activities and roundups interleaved newest first, 50 entries |

The sitemap is Skier's `generateSitemapTask` with `trailingSlash: false`.

**Feed.** `https://james.ripixel.co.uk/life/feed.xml`. Each entry is the page title, its
link, a plain-text summary (headline numbers for an activity, the totals line plus the AI
summary for a roundup), `published` (activity start / roundup generation time) and
`updated`. `/life`, the activity pages and the roundup pages advertise it with
`<link rel="alternate" type="application/atom+xml">`. The thoughts feeds (`/rss.xml`,
`/atom.xml`, `/json.json`) are unchanged and separate.

**Share cards and OG images (F5.4).** Every activity, race weekend and roundup page gets
pre-rendered share cards in three shapes — **Story** 1080×1920, **Square** 1080×1080 and
**Landscape** 1200×630, which is also the page's `og:image`:

- `tasks/fitness-share-models.mjs` — what goes on each card, from the pages' own view models:
  `event` (a race weekend: every race's total, division, PB badge or gap), `race` (Hyrox:
  interleaved runs/stations with per-segment avg HR, ranks, PB or vs PB), `parkrun` / `run`
  (distance, time, pace, km splits, route; position, count, age grade and PB or the gap),
  `strength` (Hevy: sets, volume, top sets, the session's PBs heaviest lift first), `other`
  (rides, walks, classes: the four numbers and the HR trace) and `roundup` (totals, sport
  donut, calendar heatmap, PR wall, vs last period).
- `scripts/share-cards.mjs` — the drawing (SVG). Two looks: his photo full bleed under an
  ink scrim, or the activity family's riso ink as the ground (`TYPE_INKS` in
  `tasks/fitness-theme.mjs`, kept equal to `fitness-types.css` by a test), with the zine
  frame, Anton and JetBrains Mono either way.
- `tasks/fitness-og-images.mjs` — scope, backgrounds, rendering, cache, manifest. All three
  shapes for activities from the last 90 days, every race, every PB activity, every race
  weekend and recent (and year) roundups; older pages get the Landscape card only.
  Backgrounds: the photo when there is one (else the ink); full-scope cards also get the ink
  version, races every photo (up to three) and race weekends a collage of their races'
  photos first. Photo cards are JPEG, ink cards palette PNG.

Rasterising is in-process with [`sharp`](https://sharp.pixelplumbing.com/) (a
devDependency); the Anton / JetBrains Mono faces come from the `@fontsource` packages and are
unpacked to `.cache/fonts/` for fontconfig on first use. Every card is cached in `.cache/og/`
under its published path, keyed by a hash of its SVG, its background URLs and
`RENDER_VERSION` (bump it when the compositing changes), so a rebuild only rasterises what
changed; photos are fetched once into `.cache/og/photos/`. A cold build renders ~2,100 cards
in about two minutes; a warm one copies them in under a second. A photo that cannot be
fetched drops that background (`FITNESS_SHARE_PHOTOS=off`, or the fixtures source, skips the
network), a page with no card falls back to its AI banner → first photo → `card_life.png`,
and the build carries on.

The **Share** button (`personal/partials/share-button.html`, `fitness-share.css`) is on
every activity, race weekend and roundup page. It opens a picker (shape, and background where
there is a choice) over the pre-rendered files; on a phone **Share…** hands the image file
to the share sheet (Web Share API level 2: Instagram Story, WhatsApp…), elsewhere — and as
the fallback — it downloads. `…#share` opens the picker on load.

`/life/share/index.json` lists the full-scope cards (`id`, `kind`, `template`, `title`,
`label`, `date`, `page` with `#share`, `image`, `race`, `pb`, `hash`, newest first). The box
copies it after each deploy and Jarvis pushes "Your Hyrox card is ready" for new race and
PB cards (`jarvis/gateway/domains/sharecards.py`).

- Re-render the section cards: `node scripts/generate-og-images.mjs`
- Preview the share cards without a full build: `node scripts/generate-og-images.mjs --fitness [outDir]`

---

## Why Skier?

Because life’s too short to debug your own static site generator.
Skier is minimal, type-safe, and doesn’t try to outsmart you.
Want to see how it works? Check out [Skier on GitHub](https://github.com/ripixel/skier).

---

## License

MIT
