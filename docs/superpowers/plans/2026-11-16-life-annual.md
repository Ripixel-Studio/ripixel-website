# Life in [year] (the annual scrapbook) Implementation Plan

> **SHELVED 2026-11-18** (James): fitness dominated the preview. See the spec status line.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generated once-a-year scrapbook page, `/life/annual/YYYY`, covering everything on `/life`. Lifehub computes a public `life/annual-YYYY.json`, and the website renders it merged with the FitGlue fitness data. First milestone: a 2026 preview built as if the year had ended on 30 November (December blank), on a Firebase preview channel.

**Architecture:** Two repos.
- **`jarvis` (lifehub):** a new module `gateway/lifehub/annual.py` builds the annual doc. Its inputs are the current public export (`export.build`), the box's history and datasets for day dates, and the public FitGlue site index for fitness moments. It is screened by `export.assert_public`, extended with a narrow allow-list for this one file.
- **`ripixel-website`:** a new view builder `tasks/life-annual.mjs` merges the doc with the fitness sessions (photos, captions, the day grid shared with the fitness year review). It renders `personal/templates/annual.html`, plus a taped-in cover on `/life`.
- **Cards and freezing:** monthly highlight and letter cards, plus freezing, live in a small `gateway/lifehub/annual_cards.py` driven from the lifehub domain's fetch, the way `quips.py` is.

**Tech Stack:** Python 3 (jarvis venv, standalone test scripts); Node ESM + Skier + Handlebars (website, `node --test`); Haiku via `oneshot.one_shot`; ffmpeg for the video.

**Spec:** `docs/superpowers/specs/2026-11-16-life-annual-design.md` (this repo, branch `life-annual-design`).

## Global Constraints

- **Positive only.** No lows, no gaps, no dropped or unfinished items, and no comparisons that read as judgement.
- **Nothing new is exposed.** A title, artist, book, game or show appears in the annual only if it appears in the current public export (`export.build(now)`): its shelves, walls, notables or sections. History and datasets supply only *days* and *minutes* for those published rows.
- **Exact days are allowed in `annual-YYYY.json` only.**
  - Live events, gaming days and big coding days get their day, and live events get a venue name.
  - `life/index.json` and the period sidecars keep month precision. Their guard is unchanged.
  - No time of day anywhere: no `HH:MM`, no hour buckets.
- **No real person's name** is typed into either repo, a template or code. Names reach the page only inside James's own published activity descriptions, at build time.
- **No emoji** in templates or generated text. James's own text is exempt. `no-emoji.test.mjs` must keep passing.
- **Voice:** generated text goes through the voice guide (`voice.text()`) and is checked by `insights.guard` (exact numbers, no invented names) plus `voice.public_ok`. If the model fails or the guard refuses, a template sentence is used.
- **URL** `/life/annual/<YYYY>` (directory form, `index.html`). Bucket object: `site/james/life/annual-<YYYY>.json`, `schemaVersion: 1`.
- Local servers bind 127.0.0.1. Screenshots go in `~/work/shots/2026-11-16-life-annual/`. Website PRs embed screenshots.
- `jarvis`: push to `main` and run `scripts/safe_reload.sh`. `ripixel-website`: branch + PR, merged with `gh pr merge --merge`. Push after every commit.
- Tests never write live `~/.jarvis` state. Point `JARVIS_LIFEHUB_DIR`/`store.DIR` at a tmp dir, as `test_lifehub_periods.py` does.

## Review Focus

1. **A month with nothing in it** (the blank December in the preview, early 2025): the spread shows an empty-page treatment ("nothing taped in yet"), never a broken polaroid or "0 sessions". Test: Task 11 `month without moments renders empty page`.
2. **A gig with no calendar event, so no venue:** the stub shows title and day with no venue line, and no venue first is claimed. Test: Task 2 `venue_of returns None without a calendar match`, Task 5 `no venue first without a venue`.
3. **An item made private after the year was built** (James taps "Keep private" in the held-back queue): the next build drops it from moments, collage and connections, because everything is intersected with the current export. Test: Task 3 `unpublished title is not a moment`.
4. **Firsts that are not really firsts:** history starts at different dates per source (fitness 2025-04-02, Netflix 2022-11, bookings by Gmail). A first is claimed only when that source's history starts at least 365 days before the event. Test: Task 5 `first needs a year of prior history`.
5. **The guard relaxation leaking:** the `venue`/day allowances must apply only to the annual doc's own paths. The same keys in `index.json` still refuse. Test: Task 1 `index still refuses venue`.

---

## Part A: lifehub (repo `Ripixel-Studio/jarvis`, work in a worktree `~/work/wt/jarvis-annual`, branch `rethink/annual-life`)

### Task 1: Guard allow-list for the annual doc

**Files:**
- Modify: `gateway/lifehub/export.py` (`_violation`, `assert_public`)
- Test: `gateway/test_lifehub_annual.py` (new; standalone script in the style of `test_lifehub_periods.py`)

**Interfaces:**
- Produces: `export.assert_public(doc: dict, place_words: set[str], allow: tuple[re.Pattern, ...] = ()) -> None`. A path matching any `allow` pattern is exempt from `FORBIDDEN_KEYS` for its own key, and its string value is exempt from place words. Time-of-day and money checks still apply.
- Produces: `annual.ALLOW = (re.compile(r"^moments\[\d+\]\.venue$"), re.compile(r"^firsts\[\d+\]\.venue$"))`. `annual.py` is created here with only this constant and the `OBJECT`/`SCHEMA_VERSION` constants: `OBJECT = "site/james/life/annual-{year}.json"`, `SCHEMA_VERSION = 1`.

- [ ] **Step 1: Write the failing tests**
  - `test_annual_allows_venue`: `assert_public({"moments": [{"venue": "Royal Concert Hall", "day": "2026-04-24"}]}, {"royal"}, allow=annual.ALLOW)` does not raise.
  - `test_index_still_refuses_venue`: the same doc with `allow=()` raises `ValueError("moments[0].venue")`.
  - `test_annual_refuses_time`: `{"moments": [{"venue": "Hall 19:30"}]}` with `annual.ALLOW` raises.
- [ ] **Step 2:** Run `.venv/bin/python gateway/test_lifehub_annual.py`. Expect FAIL (no `allow` parameter).
- [ ] **Step 3:** Implement. Thread `allow` through `_violation`. The check is on the full path `p` before the `FORBIDDEN_KEYS` test, and on `path` before the place-word string test.
- [ ] **Step 4:** Run the new test, `gateway/test_lifehub_export.py` and `gateway/test_lifehub_periods.py`. All pass.
- [ ] **Step 5:** Commit: `lifehub annual: guard allow-list for the annual doc's venues`.

### Task 2: Venue names for live events

**Files:**
- Modify: `gateway/lifehub/live.py` (add a function)
- Test: `gateway/test_lifehub_annual.py`

**Interfaces:**
- Produces: `live.venue_of(item: dict, cal_history: dict) -> str | None`.
  - Input: a `gig`/`cinema` history item and `store.read_json("calendar-history.json", {})`.
  - Finds the calendar event on the item's day whose title matches (`crossrel.bare` equality or containment).
  - Returns the first comma-separated segment of its location, stripped. Returns None when there is no match, the location is empty, or the segment starts with a digit (a street address).
  - The implementer reads `calendar-history.json`'s shape on the box first and matches it.

- [ ] **Step 1: Tests**
  - `venue_of returns segment`: location `"Royal Concert Hall, Theatre Square, Nottingham NG1 5ND"` gives `"Royal Concert Hall"`.
  - `venue_of returns None without a calendar match`.
  - `venue_of skips a street address`: `"12 High Street, ..."` gives None.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. PASS. Then run once against live data, read-only: `.venv/bin/python -c` that prints `venue_of` for every 2026 `gig:` item. Note the hit rate in the commit message.
- [ ] **Step 5:** Commit.

### Task 3: The annual doc core: days and moments

**Files:**
- Modify: `gateway/lifehub/annual.py`
- Test: `gateway/test_lifehub_annual.py` (fixtures: a small export doc dict, history dict, fitness index dict, built in the test)

**Interfaces:**
- Consumes: `export.build(now)` (the public doc), `export.make_ctx(now)`, `live.venue_of`.
- Produces:
  - `annual.Inputs` dataclass: `doc` (public export), `ctx` (export.Ctx), `fitness` (the FitGlue site index dict), `cal` (calendar history).
  - `annual.inputs(now: datetime, session=None) -> Inputs`: reads the fitness index with `showcase_bucket.current(session, heatmap.INDEX)`.
  - `annual.days(year: int, inp: Inputs, through: date) -> dict[str, list[str]]`.
    - Maps day to life kinds, in the fixed order `("live", "book", "screen", "gaming", "code")`.
    - **live:** a published live row's day.
    - **book:** a published shelf book's finish day.
    - **screen:** a published film's day, or a published series' last episode day in the year.
    - **gaming:** League `durationS` plus Steam daily minutes that day ≥ `GAMING_NIGHT_MIN = 120`.
    - **code:** commits that day across `github.repos[*].commits_by_day` ≥ `BIG_CODE_DAY = 20`.
    - Only days ≤ `through`.
  - `annual.moments(year: int, inp: Inputs, through: date) -> list[dict]`. Each moment is `{id, kind, day, month, title, sub, image, href, score, race, photo}`, with `kind` one of `live|book|screen|gaming|code|fitness`.
    - **Fitness moments** (`id = "fitness:<slug>"`): only races, plus sessions with a photo and ≥ 60 min or ≥ 15 km.
    - **Live moments** carry `venue` when `venue_of` finds one.
    - **Gaming moments:** one per month at most, the biggest gaming night (title `"Game night"`, `sub` = top game by minutes that day, if that game is on the published games wall).
    - **Code moments:** at most one per month, the biggest commit day, title from the busiest public project's name.
  - `annual.score(m: dict) -> int` with weights `SCORE = {"race": 100, "first": 80, "live": 70, "fitness": 40, "book": 40, "screen": 30, "gaming": 30, "code": 25}` plus `PHOTO_BONUS = 15`. `first` is added in Task 5.

- [ ] **Step 1: Tests**
  - `days marks a gig, a book, a game night, a code day` (one fixture day each, exact lists).
  - `days stops at through` (a 2026-12-05 gig is absent when `through=date(2026,11,30)`).
  - `unpublished title is not a moment`: a history gig whose title is not in the fixture export's live rows yields no moment and no `live` day.
  - `fitness race is a moment with photo bonus`: score is 115 with a photo.
  - `game night needs 120 minutes`: 119 gives none.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement. Match published rows to history items by key where the export row carries one, else by `crossrel.bare(title)`. A row in the export with no matching history day is month-only and is never put on a day.
- [ ] **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit.

### Task 4: Collage, hours and totals

**Files:**
- Modify: `gateway/lifehub/annual.py`
- Test: `gateway/test_lifehub_annual.py`

**Interfaces:**
- Produces `annual.collage(year, inp, through) -> dict` with keys:
  - `shelf`: `[{title, creator, cover, day}]`, the year's finished published books, by day, cap 40.
  - `mixtape`: `{artists: [{name, minutes, image}], minutes}`. Top 10 artists by the year's minutes, only artists the shelf gate passes (`export._shelf_ok(ctx)(row, "artist", shelves.artist_vk(name))`).
  - `telly`: `[{title, poster, kind}]`. Published films and series with a day in the year, by minutes, cap 24.
  - `games`: `[{title, hours, cover}]`. Published games-wall entries with play in the year (League from `riot_matches`, Steam from `steam.daily`), hours rounded, cap 8.
- Produces `annual.hours(year, inp, through) -> dict` of whole hours: `{reading, listening, watching, playing, training}`, plus `{commits}` as a count.
  - Building has no honest hours, so the site shows commits as a stamp beside the bar.
  - Watching uses `export._watch_minutes(ctx, (start, end))`. Reading uses audiobook `minutes_by_day`. Training uses the fitness index `durationSeconds`.
- Produces `annual.totals(year, inp, through) -> dict`: `{live, books, films, series, artists, commits, gameHours, sessions, races}` for the cover numbers.

- [ ] **Step 1: Tests:** one assertion per key from a fixture with known values. Also `mixtape drops an artist the gate refuses`.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit.

### Task 5: Firsts

**Files:**
- Modify: `gateway/lifehub/annual.py`
- Test: `gateway/test_lifehub_annual.py`

**Interfaces:**
- Produces `annual.firsts(year, inp, through, moments) -> list[dict]`, items `{id, day, kind, text, momentId, venue?}`. Kinds:
  - `race_family`: first Hyrox, Spartan, DEKA, marathon or half marathon, from fitness titles. Use `FAMILIES = (("Hyrox", r"^Hyrox "), ("Spartan", r"^Spartan "), ("DEKA", r"^DEKA "), ("marathon", r"\bmarathon\b(?!.*half)"), ("half marathon", r"\bhalf marathon\b"))`, case-insensitive, `isRace` only.
  - `parkrun_place`: first parkrun at a place, from `^(.+) parkrun \(#\d+\)`.
  - `act_live`: first time seeing an act. The gig title has no earlier `gig:` history item.
  - `venue`: first time at a venue, via `venue_of`, never seen in an earlier gig.
  - `text` comes from templates: `"First {family}."`, `"First parkrun at {place}."`, `"First time seeing {title} live."`, `"First night at {venue}."`
- A first counts only when that source's history starts ≥ `FIRST_HISTORY_DAYS = 365` before the event. Sources and starts:
  - fitness: earliest `startTime` in the index
  - gigs: earliest `gig:` history `first`
- Each moment that is a first gets `first: True`, and its score gains `SCORE["first"]`.

- [ ] **Step 1: Tests**
  - `first Hyrox`
  - `second Hyrox is not a first`
  - `first needs a year of prior history` (fitness history starting 2025-04-02 means a 2026-03-01 Hyrox is not a first, and a 2026-05-01 one is)
  - `no venue first without a venue`
  - `parkrun place first`
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit.

### Task 6: Highlights, connections and the letter

**Files:**
- Modify: `gateway/lifehub/annual.py`
- Test: `gateway/test_lifehub_annual.py` (`one_shot` stubbed, as `test_lifehub_quips.py` does)

**Interfaces:**
- Produces `annual.highlights(moments, state_picks: dict[str, str]) -> dict[str, dict]`, giving `{"YYYY-MM": {"pick": id, "by": "james"|"jarvis", "alternatives": [id, id, id]}}`.
  - The pick is James's id if present and still a moment. Otherwise it is the top score, with ties broken by photo, then earliest day.
  - Months with no moments are absent.
- Produces `annual.connection_candidates(year, inp, moments, through) -> list[insights.Candidate]`. Kinds:
  - `race_week`: top artist by plays in the 7 days before a race, at least 5 plays, artist gate passed.
  - `best_month`: the month with the most training hours, and its top artist.
  - `book_to_screen`: a finished book's `crossrel.bare` title equal to a film or series watched later in the year.
  - `after_show`: the export's `sections.live.afterShow` rows in the year.
  - `big_weekend`: a live event within 2 days of a race.
  - Each candidate has `numbers`, a `template` that passes `insights.guard` against itself, and `facts`.
  - Cap: one per month and 8 in all, highest score first.
- Produces `async annual.phrase(cands, one_shot=None) -> list[dict]`, giving `[{month, kind, text, by}]`.
  - One Haiku call for all candidates. The prompt is `voice.text()` plus the rule "a margin note, under 90 characters, a pattern not a cause, positive".
  - Each answer must pass `insights.guard(text, c)` and `voice.public_ok(text, 90)`, else the template is used.
  - Cache by a hash of the candidates in `annual.json` state (as `hub.pick` does).
- Produces `annual.predictions(year, inp, through) -> list[dict]`, giving `[{key, text, target}]` for `books`, `live` and `parkruns`.
  - `target` = this year's count when H2 ≤ H1, else `round(count * H2 / H1)`.
  - The count is through `through`, and H2 is scaled by its covered days.
  - `text` comes from a template, e.g. `"{target} books finished."`.
- Produces `async annual.letter(year, inp, totals, predictions, one_shot=None) -> dict | None`, giving `{lines: [str, ...], predictions}`.
  - The model writes 3–5 short lines in the voice, using only the given numbers.
  - Each line is guarded. Any failing line drops the whole letter back to a template letter (two fixed lines plus the predictions).

- [ ] **Step 1: Tests**
  - `james's pick wins`
  - `stale pick falls back`
  - `race_week candidate`
  - `guard failure uses template` (the stub returns a line with a wrong number)
  - `predictions target`
  - `letter falls back to template when a line fails`
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit.

### Task 7: Build, publish, CLI

**Files:**
- Modify: `gateway/lifehub/annual.py`
- Create: `scripts/lifehub_annual.py`
- Modify: `scripts/lifehub_collect.py` (call `annual.publish(now)` after `export.publish`)
- Modify: `docs/domains/lifehub.md` (an "The annual" section: object, schema, freeze rule)
- Test: `gateway/test_lifehub_annual.py`

**Interfaces:**
- Produces `async annual.build(year: int, now: datetime, through: date | None = None, inp: Inputs | None = None, one_shot=None) -> dict | None`, giving:

  ```
  {schemaVersion: 1, year, through, final, generatedAt,
   days, moments, highlights, collage, firsts, connections, hours, totals,
   letter: {lines, predictions, approved} | null}
  ```

  - `through` defaults to `min(now.date() - 1 day, Dec 31)`.
  - `final` is true when `now.date() >= date(year + 1, 1, 1)`.
  - Returns None when fewer than `MIN_MONTHS = 6` months have a highlight.
  - `letter` is included only when `state.letter[year].approved`, or when building for a preview (`preview=True` keyword, which sets `approved: false`).
- The doc also carries `lastLetter`: `{predictions: [{key, text, target, actual, hit}]}`.
  - Built when last year's bucket doc (`showcase_bucket.current`) has an approved letter.
  - `actual` comes from this year's `totals`, and `hit` is `actual >= target`.
  - The site opens the issue with it. For 2026 it is absent.
- Produces `annual.publish(now, session=None, send=None) -> dict[int, str]`.
  - From 1 to 31 January, builds `year = now.year - 1`, guards it with `assert_public(doc, words, allow=ALLOW)`, and uploads with `showcase_bucket.publish_json`.
  - On 1 February it records the year in state `frozen`. A frozen year is never rebuilt.
  - At any other time of year it returns `{}`.
  - A refused guard sends the existing `export.REFUSED_TEXT` notice.
- State file `annual.json`: `{picks: {"YYYY-MM": id}, letter: {"YYYY": {lines, approved}}, frozen: [YYYY], phrase: {hash, answer}}`.
- CLI `scripts/lifehub_annual.py --year 2026 [--through 2026-11-30] [--preview] [--out PATH] [--upload]`.
  - Builds, guards, and writes JSON to `--out` (default stdout).
  - `--upload` refuses unless `final`.

- [ ] **Step 1: Tests**
  - `build has every key`
  - `build is None under six months`
  - `publish is a no-op in June`
  - `publish uploads last year in January` (fake session)
  - `frozen year is skipped in February`
  - `guard refusal sends notice`
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the new test, `gateway/test_lifehub_export.py` and `gateway/test_lifehub_periods.py`. Then run `scripts/lifehub_annual.py --year 2026 --through 2026-11-30 --preview --out ~/work/tmp/keep/annual-2026-preview.json` against live data.
  - Check that it passes the guard.
  - Read it by hand: every title is one already on `/life`, there is no `HH:MM`, and the venues look like venue names.
- [ ] **Step 5:** Commit, push the branch, merge to `main`, then run `scripts/safe_reload.sh`.

---

## Part B: website (repo `ripixel-website`, worktree `~/work/wt/ripixel-website-annual`, branch `life-annual`, cut from `life-annual-design`)

### Task 8: Fetch the annual docs

**Files:**
- Modify: `tasks/fitness-fetch.mjs`
- Test: `tasks/fitness-fetch.test.mjs`

**Interfaces:**
- Produces `validateAnnual(doc, year, logger) -> any|null`. It needs `schemaVersion === 1`, `year === year` and a `days` object, else null with a warning.
- Produces `lifeAnnuals: Record<string, any>` on the raw and assembled sets, keyed `"2026"`.
  - Live: `getFileLenient(\`life/annual-${y}.json\`, true)` for every `y` with a `year-<y>` roundup key in the index.
  - Local dir: `life/annual-<y>.json`.
  - Preview: env `LIFE_ANNUAL_PREVIEW=<abs path>` reads that file and sets `doc.preview = true`. It overrides the bucket's doc for the same year.

- [ ] **Step 1: Tests**
  - `annual validated`
  - `wrong year dropped`
  - `preview env file wins and is marked preview`
- [ ] **Step 2:** Run `node --test tasks/fitness-fetch.test.mjs`. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit.

### Task 9: Share the day grid

**Files:**
- Create: `tasks/year-days.mjs`
- Modify: `tasks/fitness-year-review.mjs` (use it; output unchanged)
- Test: `tasks/year-days.test.mjs`, plus `tasks/fitness-year-review.test.mjs` unchanged and passing

**Interfaces:**
- Produces `dayGrid(year: number, cellOf: (day: string) => object, lastDay: string) -> { cols: { month?: string, cells: object[] }[] }`.
  - Moves the column/blank-lead/month-label logic out of `buildYearReview` (around lines 115–135).
  - Each cell is `{ day, dow, i, ...cellOf(day) }`, with `future: true` after `lastDay`.

- [ ] **Step 1:** Tests: `53 or 54 columns, Monday lead blanks, month labels once`.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement and switch `buildYearReview` to it.
- [ ] **Step 4:** Run `npm test`. All pass, including the year review's.
- [ ] **Step 5:** Commit.

### Task 10: The annual view

**Files:**
- Create: `tasks/life-annual.mjs`
- Test: `tasks/life-annual.test.mjs`

**Interfaces:**
- Consumes: `lifeAnnuals`, `dayGrid`, and `storyContext` from `fitness-roundup-story.mjs` (the same `ctx` the year review gets: `list`, `files`, `showPhotos`).
- Produces `buildLifeAnnual(doc, ctx, opts?: { now?: number }) -> view`:
  - **`cover`:** `{year, numbers: [...], days: dayGrid(...)}`.
    - Cell ink priority: race, then live, then a fitness session (its tag's `typeClass`), then book, gaming, code, screen, then rest.
    - Life inks are `life-ink--live|reading|games|code|watching`.
    - Each cell's `href` is `#m-YYYY-MM`. Fitness sessions are only those ≤ `doc.through`.
  - **`months`:** twelve entries `{key, label, anchor, highlight, polaroids, stubs, captions, notes, empty}`.
    - `highlight` is the moment named by `doc.highlights[key].pick`. For `fitness:<slug>` it is enriched from `ctx.files` (photo, title, href, description trimmed to 140 chars at a word boundary).
    - `polaroids` are the month's fitness photos, cap 6.
    - `stubs` are live moments with day and venue.
    - `notes` are the connections for that month.
    - `empty` is true when there is no highlight.
  - **`collages`:** `{shelf, mixtape, telly, games, medals}`. `medals` are the year's fitness races, as `{title, day, href, family}`.
  - **`placements`:** the collage after which month: shelf after March, mixtape after June, telly after August, games after October, medals after December. A collage with fewer than 3 items is dropped.
  - **`firsts`**, **`hours`** (bar segments with share %, plus a commits stamp) and **`fitness`** (best photo, 3 numbers, href to `/life/roundup/year-YYYY`).
  - **`letter`:** `doc.letter` with `draft: !doc.letter.approved`.
  - **`linkCover`:** `{year, href, size: 'large'|'slim', thumbs}`. `size` is large when `opts.now` falls in January of `year + 1`, or when `doc.preview`.
- Produces `lifeAnnualTask()`, which sets globals:
  - `lifeAnnualPages`: one per doc that is `final` or `preview`.
  - `lifeAnnualCovers`: newest first, the same filter.

- [ ] **Step 1: Tests**
  - `cover priority race over live`
  - `fitness after through is not drawn`
  - `month without moments renders empty page`
  - `fitness highlight gets photo and trimmed caption`
  - `collage under 3 items dropped`
  - `cover large in January and in preview, slim in March`
  - `non-final non-preview doc has no page`
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement. Reuse `TAGS`/`tagTheme` and `cardPicture` from the fitness modules. Every string comes from the doc or the fitness files: no hand-written data.
- [ ] **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit.

### Task 11: The page

**Files:**
- Create: `personal/templates/annual.html`, `personal/partials/annual-*.html` (cover, month, collage, firsts, hours, fitness, letter), `personal/assets/styles/main/life-annual.css`
- Modify: `tasks/life-pages.mjs` (a `generateDataPagesTask` over `${lifeAnnualPages}`, `outPath` `life/annual/<year>/index.html`), `skier.personal.tasks.mjs` (register `lifeAnnualTask()` after `fitnessRoundupViewsTask()`), and the CSS bundle list wherever `fitness-year-review.css` is listed
- Test: `tasks/life-annual.test.mjs` (render check with the repo's existing Handlebars helper approach used by `fitness-roundup-views.test.mjs`); `tasks/no-emoji.test.mjs` and `tasks/css-balance.test.mjs` pass

**Design (the scrapbook, mockup C):**
- Paper and zine background as on `/life`.
- Month tabs down the right edge, `position: sticky`; at phone width they become a horizontal strip.
- Polaroids with tape and a stable pseudo-random tilt (reuse the year review's `rand`).
- Ticket stubs, with a perforated edge in CSS.
- Margin notes in the site's hand font.
- Collage pages as full-width spreads.
- `data-reveal` animations as the year review uses.
- A blank month shows a torn empty page with "Nothing taped in yet."
- A draft letter shows a "draft" stamp. On the preview only, a corner banner reads "Preview: built as if the year ended on <through>".

- [ ] **Step 1:** Tests:
  - `page renders a month anchor per month`
  - `stub without venue has no venue line`
  - `draft stamp only when draft`
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Then build with:

  ```
  LIFE_ANNUAL_PREVIEW=~/work/tmp/keep/annual-2026-preview.json FITNESS_PREVIEW_ROUNDUPS=year-2026 FITNESS_DATA_SOURCE=live SKIER_SITE=personal npx skier
  ```

  Shoot `/life/annual/2026` at 2560 and 390 widths with `scripts/shoot.py`, into `~/work/shots/2026-11-16-life-annual/`. Look at the shots, and fix overlaps, broken images and empty tags.
- [ ] **Step 5:** Commit.

### Task 12: Links in: the /life cover, the fitness issue, Roundups

**Files:**
- Create: `personal/partials/life-annual-cover.html`
- Modify: `personal/pages/life.html` (insert after the `life-hub__hero` header, before `did-you-know`), `personal/partials/yr-review.html` (a "Life in YYYY" line in the closing chapter), `personal/pages/life/roundups.html` (an "Annual" line above the list), `personal/assets/styles/main/life-annual.css`
- Test: `tasks/life-annual.test.mjs`

**Interfaces:**
- Consumes `lifeAnnualCovers` (Task 10).
- Large cover: full width, about −1.5° tilt, a tape strip, a day-grid thumbnail (a 53×7 mini of `cover.days`, inks only, no links), "Life in YYYY" and one line.
- Slim strip: the same elements at 64 px tall, with year tabs when there are 2 or more covers.
- No covers means nothing renders.

- [ ] **Step 1:** Tests:
  - `life page has no cover without annuals`
  - `slim strip shows year tabs for two years`
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, rebuild as in Task 11, and shoot `/life` at both widths.
- [ ] **Step 5:** Commit.

### Task 13: Preview for James (his immediate ask)

- [ ] **Step 1:** Regenerate the doc fresh:

  ```
  scripts/lifehub_annual.py --year 2026 --through 2026-11-30 --preview --out ~/work/tmp/keep/annual-2026-preview.json
  ```

- [ ] **Step 2:** Build as in Task 11, Step 4.
- [ ] **Step 3:** Deploy:

  ```
  firebase hosting:channel:deploy life-annual --only personal --project ripixel-f24bf --expires 30d
  ```

  Save the channel URL to `~/work/tmp/keep/annual-channel`.
- [ ] **Step 4:** Open `/life/annual/2026` and `/life` on the channel URL. Shoot both at 2560 and 390, into `~/work/shots/2026-11-16-life-annual/preview-*.png`.
- [ ] **Step 5:** Open a draft PR from `life-annual` with the shots embedded, then hand over to James:
  - the channel link
  - the shots link
  - the list of firsts and venues to check by eye (Review Focus 2 and 4)
  - the note that December is blank on purpose

### Task 14: Highlight and letter cards (lifehub; after James has reviewed the preview)

**Files:**
- Create: `gateway/lifehub/annual_cards.py`
- Modify: `gateway/domains/lifehub.py` (`fetch` calls `annual_cards.maybe_ask(now)`), `gateway/compose.py` (`CALM_QUESTIONS += ("annual-",)`)
- Test: `gateway/test_lifehub_annual_cards.py` (patterned on `test_lifehub_quips.py`, with `askquestion.raise_question` faked)

**Interfaces:**
- Produces `annual_cards.maybe_ask(now) -> str | None`:
  - **Highlight card:** on day 1–7 of a month, once per month, for the month just closed (December's on 1 January).
    - The card is `askquestion.raise_question("Life hub", [{header: "<Month> highlight", question: "Keep <pick title>?", options: [{"label": "Keep"}, ...up to 3 alternatives' titles]}], "home", cb, rid="annual-pick-YYYY-MM")`.
    - An answer writes `annual.json` `picks`. In January it also calls `annual.publish(now)`.
  - **Letter card:** from 20 December, once. The question shows the letter's lines, with options `Publish it` / `Leave it out`. The answer writes `letter[year].approved`.
  - Re-raise after a reload as `quips.maybe_ask` does.
- Needs no expectations entry: the card is the ask itself, as with quips.

- [ ] **Step 1:** Tests:
  - `one card per closed month`
  - `answer stores pick`
  - `december card on 1 January`
  - `letter card from 20 December only once`
  - `answer in January republishes`
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the new test and `gateway/test_lifehub_quips.py`. Both pass.
- [ ] **Step 5:** Commit, push to `main`, run `safe_reload.sh`.

### Task 15: Share cards and the short video

**Files:**
- Create: `tasks/life-annual-share.mjs`, `tasks/life-annual-share.test.mjs`
- Modify: `tasks/fitness-og-images.mjs` (render the annual deck alongside `renderYearDeck`)

**Interfaces:**
- Produces `annualDeck(view) -> card[]`, a 15-card set: the cover, then twelve month highlights (blank months skipped), then firsts, then hours.
- Produces `renderAnnualDeck(view, outDir, opts)`: PNGs at `life/annual/<year>/share/NN.png`, plus a 20 s MP4 `life/annual/<year>/share/year.mp4`, made the same way `fitness-year-share.mjs` makes its deck and video (same ffmpeg lookup).
- The page gets a Share button like the fitness issue's.

- [ ] **Step 1:** Tests:
  - `deck skips blank months`
  - `deck has at most 15 cards`
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, rebuild, check the MP4 plays (`ffprobe` duration ≈ 20 s), and redeploy the preview channel.
- [ ] **Step 5:** Commit and push. The PR stays a draft until James approves the preview, then merge with `gh pr merge --merge`.
