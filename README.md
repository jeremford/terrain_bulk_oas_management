# terrain_bulk_oas_management

Bulk Outdoor Adventure Skills entry for [Scouts Terrain](https://terrain.scouts.com.au).

**Use it here: <https://jeremford.github.io/terrain_bulk_oas_management/>** — no install,
runs entirely in your browser.

Recording an OAS stage for a pack through the Terrain interface means, for every
member: switching into assist mode, waiting out a slow SPA, ticking each statement
one at a time, adding a verifier, submitting, then switching back — under a
30-minute session timer. For a dozen Cubs that is an evening.

This does the same thing as a grid: members down the side, statements across the
top, one pass, one save.

> **Status: unofficial and unsanctioned.** This talks to an undocumented API using
> your own Terrain login. It is not endorsed by Scouts Australia. Read
> [`docs/SECURITY.md`](docs/SECURITY.md) before using it on anyone else's data, and
> talk to your Branch before sharing it.

## Running it

**Hosted:** <https://jeremford.github.io/terrain_bulk_oas_management/>. Pushes to the
default branch deploy the single-file build there via GitHub Pages. The hosted page is
byte-for-byte the same artefact as `npm run build` produces — everything still runs in
your browser; GitHub only serves the static file.

**Locally:** no build step, no dependencies.

```bash
git clone <this repo> && cd terrain_approvals
npm start
```

Serves on <http://localhost:8080> (`python3 -m http.server` under the hood).

A web server is needed because the app uses ES modules, which browsers refuse to
load over `file://`. To produce a single self-contained file that *can* be opened
directly — handy for giving to another leader:

```bash
npm run build
```

Writes `dist/terrain-approvals.html` — one file, no server, opens straight from disk.

## Using it

1. **Sign in** with your branch, member number and Terrain password. The password
   goes straight to AWS Cognito and is never stored. Your branch, member number and
   verifier details are remembered in this browser's `localStorage` for next time —
   passwords and tokens never are.
2. **Choose** a unit, stream and stage, and enter your verifier details.
3. **Load grid.** Members already verified show `✓` and are left alone; locked
   records (submitted or awarded) show `–`.
4. **Tick** what you observed.
5. **Preview changes** — every request is printed in full before anything is sent.
6. **Apply.**

Optionally tick *also submit for review* to move each record to pending review in
the same pass.

### Progress report

Below the load fields is **Build report**. It reads every member's OAS records for the
chosen unit, matches each against the template version it was created with, and
renders one document: a section per member listing what is awarded, each stream in
progress ordered by stream and stage, and the exact statements still unverified.
Stages that are complete but held up by an unfinished lower stage are called out at
the top of the member's section, so "one statement short of Bushcraft 2 and 3" is
visible at a glance. Tick the streams and stages to include, then download it as a
PDF or a single HTML file. The PDF is generated in the browser by the tool's own
text-only writer, so it is a few hundred kilobytes rather than the tens of megabytes
the browser's print dialog can produce. It is read-only.

### Outstanding by statement

Once a grid is loaded, **Download outstanding PDF** turns it inside out: for the chosen
stream and stage, each statement someone still needs, followed by the names of the
members without a tick for it. Statements everyone has are left off, as are members
whose record is pending review or awarded. It reflects what Terrain has recorded, not
boxes ticked in the grid but not yet applied. One page per stream and stage in most
cases, meant to be taken along to a night of activities.

### Assist mode

Terrain's interface makes you "manage achievement pathways" for a member before
editing their record, and the tool does the same: every write is wrapped in
`assume-profiles` / `revoke-assumed-profiles`, matching captured traffic from the
official UI (July 2026). This path is confirmed working for saves and submits;
see [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Layout

```
index.html              markup only
src/auth/cognito.js     Cognito sign-in, token refresh
src/api/terrain.js      REST client
src/core/template.js    OAS template fetch + statement parsing
src/core/model.js       roster ⋈ achievements
src/core/plan.js        selections -> requests (pure, no I/O)
src/ui/grid.js          grid render + selection read
src/app.js              wiring
scripts/build.mjs       single-file bundler (dependency-free)
docs/API.md             the reverse-engineered API reference
docs/DECISIONS.md       why it is built this way
docs/SECURITY.md        data handling, for Branch
```

## Safety properties

- **No backend.** Nothing this project runs sees your password, your tokens, or any
  member's data. See [`docs/DECISIONS.md`](docs/DECISIONS.md).
- **Preview before write.** `buildPlan()` performs no I/O; Apply is disabled until
  you have previewed.
- **Merge, never replace.** Terrain's `PUT` overwrites the whole answers map, so the
  client merges into the stored record. Other leaders' verifications survive.
- **Attributable.** Every write uses your own token, so Terrain records who did what.

## Acknowledgements

Cognito client ids, the `{branch}-{member}` username format and the members-service
endpoints were established by [Topo](https://github.com/NomisNostab/Topo-Blazor),
which is worth a look if you want Terrain reporting.
