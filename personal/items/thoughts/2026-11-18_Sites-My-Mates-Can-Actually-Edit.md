We've all been there - someone finds out you "do websites", and asks if you could just knock one up for them. You say yes, because you're nice, and six months later you're the only person on Earth who can change the opening times on their contact page.

This year I've built two sites for people round here - one for a [running club](https://binghamsundayrunningclub.co.uk) and one for a [personal trainer](https://dmmichthecoach.co.uk) - and I wanted to get as close as I could to the dream: a site that looks properly designed, costs next-to-nothing to run, and that _they_ can update without ever messaging me.

Turns out, you can get pretty close! The recipe is:

 - **Claude Design** to figure out what it should look like
 - **Claude** to build it
 - **[Skier](https://github.com/Ripixel-Studio/skier)**, my static site generator (yes, the "admittedly very noddy" one from the [webmentions post](/thoughts/2021-03-21_Webmentions-are-Fun.html) grew up and got a name)
 - **[Decap CMS](https://decapcms.org/)** so that non-developers can edit it
 - **Firebase Hosting** and **CircleCI** so every edit goes live by itself

## "Why not just use Squarespace?"

Honestly? You could, and for loads of people you should.

**[JAMES: your actual answer. Prompts: monthly cost vs Firebase's free tier, owning the content (it's JSON in a repo, not trapped in someone's editor), speed, no plugin updates, and - let's be honest - it being more fun.]**

## Step one: what should it look like?

I am not a designer. I can make things look _fine_, but "fine" isn't what you want when it's someone's business on the line.

For [DMMich The Coach](https://dmmichthecoach.co.uk) (Dean's personal training business), I gave Claude Design a brief and had it come back with five completely different directions for the homepage: **inclusive**, **macho**, **approachable**, **modern**, and **dense**. Dean and I went through them together, he gave his steer on direction and colours, and then the winner got taken to full desktop and mobile mock-ups.

**[JAMES: which one won, and why? The repo has `macho-full-desktop` and `macho-mobile`, so I'm guessing macho - true? Any good Dean quote from that session?]**

The bit I really like is that the output isn't a Figma file someone has to painstakingly translate - it's real HTML that lives right there in the repo (in a [`claude-design` folder](https://github.com/Ripixel-Studio/dmmich/tree/main/claude-design)), so when it came to building, I could point Claude at it and say "that, please". The running club site went through the same process.

## Step two: build the thing

The first real commit on the DMMich repo is titled `feat: implement the whole dang site`, and that's not much of an exaggeration. Design in, site out, on day one.

The rest of that week was the stuff that _always_ takes the time:

1. A drop-down menu that wouldn't drop down
2. A drop-down menu that dropped down _weirdly_
3. SEO bits, and keeping `/admin` out of the sitemap
4. Getting the CMS to behave

**[JAMES: one honest story about Claude here - where it saved you a pile of time, and where it was confidently wrong. This is the paragraph that stops the post reading like an advert.]**

The single most important decision though was that **none of the words live in the templates**. Everything is JSON: a `content/settings/site.json` for the stuff used everywhere (name, email, social links, locations - set once, used everywhere), and one file per page. The templates just render whatever's in there.

That's what makes the next bit possible.

## Step three: let them edit it

Decap CMS (which you might remember as Netlify CMS) is a single-page admin app you drop at `/admin`. You give it a `config.yml` describing your content, it gives your editors nice friendly forms, and when they hit save it **commits straight to your GitHub repo**. No database, no server, no WordPress updates at 2am.

Here's a trimmed-down version of Dean's:

```yaml
# YAML
backend:
  name: github
  repo: ripixel/dmmich
  branch: main
  base_url: https://binghamsundayrunningclub.co.uk
  auth_endpoint: api/auth
  commit_messages:
    update: 'feat(content): Update {{collection}} "{{slug}}"'

media_folder: "assets/images"
public_folder: "/images"

collections:
  - name: "settings"
    label: "Settings"
    files:
      - name: "site"
        label: "Site Settings"
        file: "content/settings/site.json"
        fields:
          - { label: "Site Name", name: "name", widget: "string" }
          - { label: "Tagline", name: "tagline", widget: "string" }
```

A couple of things to note:

 - The `commit_messages` block means Decap's commits look just like mine (`feat(content): Update pages "home"`), so the history stays readable
 - Every save is a commit, so CircleCI picks it up, builds the site, and deploys to Firebase. Dean hits save, and a couple of minutes later it's live - he doesn't need to know any of that exists

A few months later I went back and made every image CMS-controllable too, so Dean can swap his transformation photos in and out himself.

**[JAMES: has Dean actually used it? Has he broken anything? Has the "can you just change..." message ever come anyway?]**

But wait - why does Dean's `base_url` point at the _running club's_ website?

## "But Decap only works on Netlify!"

Sort of. Decap was born at Netlify, and its default login uses Netlify Identity - which needs Netlify's backend. I host on Firebase.

I learned this the hard way. Here's the first day of the running club repo's history, which reads like a man slowly losing his mind:

1. `feat: integrate Netlify Identity with Decap CMS`
2. `feat: add Netlify Identity login redirection script for admin panel`
3. `fix: use netlify app for identity and gateway`
4. `fix: attempt more changes to enable netlify login`
5. `feat: switch to function-based oauth login`
6. `fix: more attempts to get oauth working`
7. _Gulp._

It turns out that Decap's GitHub backend doesn't _need_ Netlify at all. It just needs somebody, somewhere, to do the OAuth handshake with GitHub - and that somebody has to be a server, because your OAuth client secret can't live in the browser.

So: one tiny Firebase Cloud Function, and two rewrites in `firebase.json`:

```json
// JSON
"rewrites": [
  { "source": "/api/auth", "function": "oauth" },
  { "source": "/api/callback", "function": "oauth" }
]
```

The flow goes like this:

1. Editor clicks "Login with GitHub" in the CMS
2. The CMS opens a popup at `/api/auth`
3. The function redirects them to GitHub
4. They approve the app
5. GitHub sends them back to `/api/callback` with a temporary `code`
6. The function swaps that code for an access token, and hands it back to the CMS using `window.postMessage`
7. The CMS stores the token, and talks to the GitHub API directly from then on

Step 6 is the only bit that's even slightly magic, and it looks like this:

```typescript
// TypeScript
function renderBody(provider: Provider, status: string, content: unknown): string {
  return `
    <script>
      const receiveMessage = (message) => {
        window.opener.postMessage(
          'authorization:${provider}:${status}:${JSON.stringify(content)}',
          message.origin
        );
        window.removeEventListener("message", receiveMessage, false);
      }
      window.addEventListener("message", receiveMessage, false);
      window.opener.postMessage("authorizing:${provider}", "*");
    </script>
  `;
}
```

The callback page says "I'm authorising!" to the window that opened it, waits for the CMS to say hello back, then passes over the token - only to the origin that replied - and tidies up after itself.

**[JAMES: did you adapt the function from an existing project (the setup doc mentions `decap-cms-oauth-firebase`)? If so, credit them here - you always do!]**

And here's the killer feature: **there is no user database**. Who can log in is simply who's a collaborator on the GitHub repo. Adding an editor is GitHub → Settings → Collaborators → invite, and removing one is the same in reverse. GitHub does the passwords, the 2FA, and the "I forgot my password" emails, and I do... nothing.

It also means one gateway can serve more than one site - which is why Dean's CMS logs in via the running club's domain. One function, one GitHub OAuth app, as many sites as I like.

## The twist: Decap's login as a free backend

The running club is where this got fun, because the bit that needed other people's hands wasn't really _content_ at all.

Every Sunday, someone has to record who ran, how many loops of which size they did, and their time - and those results feed the site's stats. That needs logins, permissions, somewhere to store the data, and an audit trail. In other words, all the stuff I _really_ didn't want to hand-roll for a free club website.

So I didn't. The [race tracker](https://github.com/Ripixel-Studio/bingham-sunday-running-club-race-tracker) is a little mobile-first React app with **no backend of its own**. It opens the exact same `/api/auth` popup that Decap uses, takes the GitHub token it gets back, and then uses [Octokit](https://github.com/octokit/octokit.js) to read and write files in the website repo directly:

 - Runners are read from `content/runners/*.json`
 - On race day it's a big live loop-counter and timer (with the Wake Lock API, so the phone doesn't go to sleep mid-race)
 - When the race director hits save, the results, the race photo, and any guests promoted to full runners all go into the repo as **one single commit** - `feat(runs): add run data for 2026-11-15`
 - The website build picks that up, crunches the stats, and commits the generated results back

So the "database" is a folder of JSON in git. Which means I get full history, a diff of every change, and undo for free - and if someone fat-fingers a time, it's one revert away.

**[JAMES: who does the race tracking (happy to name them?), and how has it gone in practice?]**

## So, is it actually low-friction?

**[JAMES: your verdict - what friction is left? Ideas: editors need a GitHub account (a weird ask for a PT), Decap's config quirks (there are a few `fix: admin not having some config for some fields` commits), Firebase needing billing turned on for Functions, the race tracker being your app to maintain forever.]**

For me, the takeaways are:

 - Let a designer (even an AI one) pick the direction, and let the _client_ pick from the options - it's way easier for someone to react to five ideas than describe one
 - Keep every word in data, never in templates, from day one
 - You don't need Netlify for Decap, you just need a couple of hundred lines of OAuth
 - If GitHub already knows who your users are, let it

The best site you'll ever build for a mate is the one they never have to ask you to update.
