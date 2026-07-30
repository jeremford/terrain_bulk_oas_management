# terrain_approvals

Bulk Outdoor Adventure Skills entry for [Scouts Terrain](https://terrain.scouts.com.au).

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

**Hosted:** pushes to the default branch deploy the single-file build to GitHub Pages
(enable Pages → "GitHub Actions" in the repo settings). The hosted page is byte-for-byte
the same artefact as `npm run build` produces — everything still runs in your browser;
GitHub only serves the static file.

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
