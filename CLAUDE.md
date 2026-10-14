# CLAUDE.md

Context for working on this repo. Read `docs/API.md` before touching anything that
talks to Terrain, and `docs/DECISIONS.md` before changing the architecture.

## What this is

A static, backend-free browser tool for recording Outdoor Adventure Skills across a
whole Scout unit in one pass. It exists because doing this through the Terrain web UI
means, per member: switch into assist mode, wait out a slow SPA, tick each statement
individually, add a verifier, submit, switch back — under a 30-minute session timer.
A dozen Cubs is an evening's work. This makes it one grid and one save.

It drives an **undocumented, unofficial API** using the leader's own Terrain login.
Not endorsed by Scouts Australia.

## Commands

```
npm start      # python3 -m http.server 8080
npm test       # node:test, 40 tests
npm run build  # dist/terrain-approvals.html — single self-contained file
npm run export # oas-statements.json — flat statement list from the public templates
               # export:md additionally renders it as oas-statements.md
```

ES modules will not load over `file://`, hence the dev server. `npm run build` exists
so a leader can be handed one file that opens directly with no tooling.

## Architecture — treat these as non-negotiable

**1. There is no backend, and must never be one.**
Terrain returns `access-control-allow-origin: *` and allows an `authorization` request
header, so the browser calls the API directly. The only technical reason to add a proxy
would be CORS, and that reason does not exist. Consequence: nothing this project runs
ever sees a password, a token, or youth member data. There is no breach surface, no
data retention, no cross-border transfer to justify. That property is the reason this
tool is defensible to a Branch privacy officer — do not trade it away for convenience.
An Express/Lambda auth-proxy was explicitly considered and rejected: "we don't store
credentials" is not "we don't process them".

**2. Preview before write, always.**
`src/core/plan.js` performs no I/O. It returns the exact method, path and body for every
request, which is rendered for review, and Apply stays disabled until a preview exists.
This is not only a bug guard. Each ticked box is a leader personally attesting a named
child demonstrated a skill; the friction is doing real work. A per-row "all" button
exists (added July 2026, author's call — reviewing one member's whole stage at once is
a real workflow), but the line holds elsewhere: no column-wise or grid-wide select
all, no auto-apply. Preview remains the mandatory checkpoint.

**3. Merge, never replace.**
Terrain's `PUT` replaces the entire `answers` map — anything omitted is silently dropped.
Always read the existing record, merge into it, send the whole thing. Other leaders'
verifications live in that map. `test/plan.test.mjs` guards this; if those tests ever
look inconvenient, the tests are right and the change is wrong.

**4. Statement ids come from the template at run time.**
Ids look like `important_outdoors_trails_stick_a353dc`. Never hardcode one. Fetching them
from `templates.terrain.scouts.com.au` is why every stream and stage works with no code
changes.

**5. Tokens stay in memory.**
`Session` holds them in private fields. Closing the tab ends the session. The one thing
that persists (`localStorage`, added July 2026) is the leader's own convenience fields —
branch, member number, verifier name/contact. Never passwords, never tokens, never youth
member data; do not widen that list. The IdToken-paste escape hatch was removed when the
tool was productionised.

## Terrain API facts that will bite you

- The `authorization` header is the **bare IdToken** — no `Bearer ` prefix.
- `PUT /members/{id}/achievements/{aid}` is a **full-document replace**.
- The record echoes `last_updated`; send it back on update. Looks like optimistic
  concurrency, untested under conflict.
- **Template versions are per stage, not global.** `oas/bushcraft/1` was version 2 while
  `oas/bushwalking/1` was version 1. Existing records keep their pinned version; new ones
  take the current template's. When editing an existing record, fetch
  `/oas/{stream}/{stage}/{version}.json`, not `latest.json`, or ids can drift.
- Dates are `DD/MM/YYYY`. `verifierType` is `member`.
- Input groups use `title`, not `label`. (This was a real bug — the group name came
  through as `undefined` until it was fixed.)
- Cognito username is `{branch}-{memberNumber}`, e.g. `qld-1234567`. Four app client ids
  exist; try each until one accepts.
- Status lifecycle: `(none) -> draft_review -> pending_review`. Records in
  `pending_review`, `finalised` or `awarded` are locked and render as a dash.

`docs/API.md` marks every endpoint `[captured]` (seen on the wire) or `[inferred]` (from
Topo's source, unverified). Respect that distinction; do not promote an inferred endpoint
to captured without observing it.

## Layout

```
index.html              markup only, no logic
src/auth/cognito.js     sign-in, refresh. Private #fields, no persistence
src/api/terrain.js      REST client. One method per endpoint, no business logic
src/core/template.js    template fetch + parseStatements()
src/core/model.js       roster join achievements -> grid rows
src/core/plan.js        selections -> requests. PURE, no I/O, unit tested
src/core/report.js      roster + per-member records + templates -> progress report. PURE, unit tested
src/core/pdf.js         minimal PDF writer (Helvetica, no embedding, deflate). PURE, unit tested
src/core/report-pdf.js  progress report -> PDF layout. PURE, unit tested
src/ui/grid.js          grid render + selection read
src/ui/info.js          the info popup (full label + template dialog_text)
src/ui/report.js        progress report render, print and standalone-HTML download
src/app.js              wiring only — DOM events to the modules above
scripts/build.mjs       dependency-free single-file bundler
```

**Gotcha:** `scripts/build.mjs` has an explicit `MODULES` array in dependency order and
strips import/export syntax. It does not resolve imports. **Any new module must be added
to that array**, leaves first, or it silently vanishes from the built file while the dev
server keeps working.

## Conventions

- Zero runtime dependencies, and no build step for development. Deliberate: it keeps the
  single-file distributable possible and means there is nothing to audit or update. Do
  not introduce a framework or bundler. If something needs React, question the something.
- Plain DOM via a small `el(tag, className)` helper. Never interpolate data into HTML
  strings — use `textContent`.
- ES modules, `type="module"`, native `<dialog>`, `structuredClone`. Modern browsers only.
- Comments explain *why*, particularly where behaviour was reverse-engineered. Keep them.

## Testing

`node --test test/*.test.mjs`. Only the pure modules are unit tested — `core/plan.js`,
`core/template.js`, `core/model.js`, `core/report.js`, `core/pdf.js` and `core/report-pdf.js` — because they hold the logic that fails silently
and corrupts data.
`auth`, `api` and `ui` are DOM- or network-bound and are not unit tested; verify those
manually against a real record.

When adding behaviour to `core/`, add a test. When adding to `ui/`, don't bother.

## Open questions

1. **Writes require the assist-mode wrap — resolved July 2026.** Writes wrapped in
   `assume-profiles` / `revoke-assumed-profiles` succeed (bodies confirmed: Terrain sends
   none; `{}` also accepted), so every write is now wrapped unconditionally and the
   "use assist mode" checkbox is gone. Submits use `submit-on-behalf` with the leader's
   own member id as `submitted_by`; plain `/submit` 403s for leaders.
2. `/profiles` response schema is undocumented; `unitsFromProfiles()` walks it
   heuristically looking for unit-shaped objects. Replace with real parsing once the
   shape is confirmed.
3. `GET /units/{unitId}/achievements?...` comes from Topo, not from captured traffic.
4. Rate limits unknown. Writes are spaced 400 ms apart as a precaution.
5. Approve and award transitions have never been captured. Bulk approvals were the
   original idea but turned out to be the lesser pain point.

## Provenance

Endpoints and payload shapes were derived from HAR captures of a live Terrain session in
July 2026. Cognito client ids, the `{branch}-{member}` username format and the
members-service endpoints were established by
[Topo](https://github.com/NomisNostab/Topo-Blazor) (Blazor, reporting-focused, read-only).

**Do not commit HARs or captured payloads.** They contain live bearer tokens and youth
member PII. `.gitignore` excludes `*.har`; keep it that way, and avoid baking real member
or unit UUIDs into source or docs — they are discoverable at run time via `/profiles`.

## The judgement call this project embodies

It is unofficial software touching children's records. Two things follow. Technically:
assume the API will change without notice, so fail loudly and preview everything.
Ethically: the tool makes attestation cheap, and attestation is the whole point of the
verification step. Every design choice that adds friction to bulk-ticking is intentional.
Before this goes to leaders beyond its author, it needs a conversation with Branch —
`docs/SECURITY.md` is written to be handed over as-is.
