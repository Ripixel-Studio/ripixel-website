# Life in [year]: the annual scrapbook

Status: approved by James (2026-11-16).
Owner: James. Builder: Jarvis (website + lifehub).

## Intent

A once-a-year page that celebrates everything in James's year that lives on `/life`:
fitness, live events, books, music, TV and films, games and code. It is a companion to
the fitness year in review (`/life/roundup/year-YYYY`, PR #578), which keeps its own
issue because fitness is such a big part of his life.

Who it is for, in James's words: something *he* can look back on, and close friends and
family. They shouldn't learn anything "spicy", but it should be cool for them to see
"I did that with Kingy!", "I remember that gaming session!", "I saw him at that run!".
Recognition is the point. Friends find the moments they shared with him, and infer
that themselves. The page does not tag or name who was there.

It is **positive only**. There are no lows.

## Shape (decided)

**A scrapbook is the grounding** (mockup C), in the zine look the rest of the site uses.
Elements of the magazine (A) and the room (B) live inside it. Mockups:
`~/work/shots/2026-11-16-life-annual/directions.html` (tailnet:
https://jarvis.tail3065f7.ts.net:8443/2026-11-16-life-annual/directions.html).

In page order:

1. **Cover: "Every single day".** Reuse the fitness issue's day grid (`yr-days` in
   `personal/partials/yr-review.html`, chapter "Every single day"), not a new component
   (James: "no point re-inventing the wheel"). Each day is coloured by what it was
   mostly about across the whole of life: a race or big run, training, a live event, a
   book finished, a gaming night, a big coding day, a quiet day. Tapping a day jumps to
   it in the months below. A few headline numbers sit on the cover.
2. **Month tabs** down the side, like a real scrapbook's tabs, so readers can jump to
   a month.
3. **Twelve month spreads**, January to December. Each month has **one highlight**
   as the big polaroid, plus smaller polaroids (activity photos), taped ticket stubs
   (live events), and captions in James's own words (his Strava/Hevy descriptions,
   trimmed). Jarvis suggests the highlight; James can swap it.
4. **Collage pages** placed between months, the scrapbook version of the room:
   - **The shelf**: the year's finished books as taped-in covers.
   - **The mixtape**: a cassette insert card with the top artists as its tracklist.
   - **The telly page**: TV and film posters cut out and stuck in.
   - **Game nights**: box art and hours.
   - **The medal page**: race medals with ribbons laid flat.
5. **Firsts**: things done for the first time this year. Examples: first Hyrox,
   first Spartan, first time at a parkrun or a venue.
6. **Happy connections**: small, surprising, positive links between parts of the
   year. Examples: the soundtrack of the best training month, what was in his ears in
   race week, a book he read and then watched. They appear as handwritten margin
   notes inside the months, not as a separate stats block.
7. **Where the hours went**: one hand-coloured bar of the year's hours across
   reading, watching, playing, training and building, framed as "what filled the
   year".
8. **Fitness**: one page with the year's best photo and a few numbers, handing off
   to the fitness issue rather than repeating it.
9. **Dear [next year]**: a handwritten letter with a few predictions drawn from the
   year's trends. Next year's issue opens by scoring them.
10. **Share cards and a short video**, made the way the fitness issue makes them
    (`tasks/fitness-year-share.mjs`, build-time ffmpeg).

## Goals

- A page James is proud to send to friends and family, and enjoys rereading.
- Moments first. Numbers are texture, never the headline of a section.
- It feels like the rest of the site: zine and scrapbook, medium-specific objects,
  subtle reveal animations, and it works on a phone.
- It is generated: on 1 January the previous year's issue publishes without James
  doing anything, the same as the fitness issue. During the year a preview channel
  lets him see it early.

## Non-goals

- Lows, low points, "what went wrong", unfinished or dropped items, or before/after
  comparisons that read as judgement.
- Repeating the fitness issue.
- Saying who was at a moment, or detecting it.
- New data collectors. Use what lifehub and FitGlue already collect; backfills of
  existing sources are fine.
- Private life: calendar events other than what `/life` already publishes (live
  events, fitness) stay private.

## Anti-goals (a failure even if it works)

- Anything negative, or anything a friend would read as spicy or private.
- Reading like a dashboard or report card.
- AI text that does not sound like James, or that invents a fact.
- A real person's name typed into the website repo or into code. Names may appear
  only where James's own published words already contain them (his descriptions), at
  build time from data.
- Emoji in templates or generated text (James's own text is exempt).

## Constraints and existing parts

- **Website** (`ripixel-website`, Skier; `personal/`): the fitness issue's code is
  the model to follow and reuse: `tasks/fitness-year-review.mjs`,
  `tasks/fitness-year-races.mjs`, `tasks/fitness-year-share.mjs`,
  `tasks/fitness-year-icons.mjs`, `personal/partials/yr-review.html`, and
  `personal/assets/styles/main/fitness-year-review.css`. The preview flag works like
  `FITNESS_PREVIEW_ROUNDUPS`, and previews deploy to a Firebase channel.
- **Fitness data**: the FitGlue site export (bucket `site/james/index.json`,
  activities with titles, tags, isRace, photo_urls and descriptions).
- **Life data**: Jarvis lifehub (`~/jarvis/gateway/lifehub`) publishes
  `site/james/life/index.json`. It already writes **year period sidecars**
  (`site/james/life/period/year-YYYY.json`, `periods.py`: totals plus published
  notables), cross-page threads (`crossrel.py`), and the insights engine with its
  numbers guard (`insights.py`, `voice.py`). All public data passes
  `export.assert_public`, and the publishing filter fails closed.
- **Data limits the builder must respect**:
  - Steam has no per-day history before the hourly timer started (2026-11-04), so
    yearly game hours are League (per match, via Riot) plus Steam where it is
    known.
  - Live events in the public export are dated by month. For this page, day-level
    dates and venues come from the bookings dataset (see "Exact days on this page
    only").
  - YouTube Music history is partly from a Takeout.
  - Where a source cannot be dated to a day, it shows at month level and never
    guesses.
- **Voice**: generated text is in James's voice (`~/jarvis-memory/voice/james.md`),
  through the existing voice guard: every number exact, no invented names, no emoji.
  If the model fails, a template sentence is used.
- Local servers bind 127.0.0.1. Screenshots go in `~/work/shots/`. PRs embed
  screenshots.

## Decided by James

- Scrapbook grounding, with elements of A and B (above).
- Positive only; no lows.
- Public is fine. It exposes nothing that is not already on the site.
- The cover is the fitness issue's day grid, reused.
- Firsts, monthly highlights and happy connections are in.
- Who was there is left for readers to infer.
- **How `/life` links to it** (James, 2026-11-16): a scrapbook cover is taped in between
  the "James, by the numbers" hero and the hub grid. It shows a thumbnail of that year's
  day grid, "Life in YYYY", and one line, and the whole cover is the link. Through
  January it is large: full width, slightly tilted, with a strip of tape. From 1 February
  it shrinks to a slim strip in the same place, so the hub cards lead again. With more
  than one issue, the strip carries small year tabs ("2026 · 2025") as the back-issue
  shelf, with no separate archive page. Before an issue publishes, nothing shows on
  `/life`, and previews show it only on the preview channel.
- **Exact days on this page only** (James, 2026-11-16). Elsewhere, `/life` publishes
  live events by month only, with no venue on a date, and publishes gaming and coding
  only as totals (life-hub spec §4, `periods.py`). The annual relaxes that rule for
  itself: live events, gaming days and big coding days may colour their exact day on the
  cover, ticket stubs sit on their day with the venue, and venue firsts are allowed.
  Every other `/life` page keeps the current rule. The day-level fields go only in
  `life/annual-YYYY.json`, never into `life/index.json` or the period sidecars, and the
  export filter allows them only for that file.

## Calls made by Jarvis (James to check)

- **URL**: `/life/annual/YYYY` (for example `/life/annual/2026`), linked from the fitness
  issue, the Roundups page and `/life`. The fitness issue keeps `/life/roundup/year-YYYY`.
- **Where the computation lives**: lifehub builds a public `life/annual-YYYY.json`
  (days, moments, highlight suggestions, collage lists, firsts, connections, hours,
  letter), screened like every other export. The website renders it and merges in the
  FitGlue fitness activities for photos and captions, as the fitness issue does.
- **Monthly highlight swaps and the letter**: Jarvis's suggestions go to James as a
  home-screen card ("this month's highlight", with the alternatives). Untouched
  suggestions publish as they are. The letter is held for his tap before it first
  publishes.
- **Timing of those cards**: a highlight card goes out as each month closes, so
  December is not a pile-up. The letter card goes out on 20 December. On 1 January the
  issue publishes whatever state it is in: unanswered highlights use Jarvis's pick,
  and an unapproved letter is simply left out. A later swap or letter approval
  republishes the page. The annual JSON keeps updating until 31 January, then it is
  frozen. A frozen year changes only by hand.
- **Days, not hours**: the relaxation covers which day something happened, not when
  in the day. Times of day for gaming and coding stay masked, so the page shows no
  working-hours patterns.
- **Which years**: 2026 is the first issue. A 2025 issue renders if the data supports
  enough months; the builder decides the bar, as the fitness issue did.
- **Happy connections**: computed by code from the published data only, phrased by
  the model, and held to the insights guard. They must be positive, and only patterns,
  never causes.

## Left to the builder

- Day-colour rules for the cover: priority when a day has several things, and what
  counts as a "big coding day".
- Highlight scoring: photos, race or first, live event, James's own words.
- Collage page placement between months, and their caps.
- The "firsts" rules and how far back the history goes for each source.
- The letter's prediction set, and how next year's issue scores it.
- Share card set and video length.
- Animations and the phone layout, within the site's existing patterns.
