# Design decisions

## 1. No backend

**Decision.** The tool is a static page. There is no server component, and none is planned.

**Why.** Terrain's API returns `access-control-allow-origin: *` and permits an
`authorization` request header, so a browser can call it directly from any origin.
The only technical reason to introduce a proxy would have been CORS, and that reason
does not exist.

**What this buys us.** Nothing this project operates ever sees a leader's password,
their tokens, or any youth member's data. There is no database to secure, no logs to
scrub, no breach surface, and no cross-border transfer to explain. Hosting is a static
file, or no hosting at all via `npm run build`.

**Rejected alternative.** An Express or Lambda layer replicating Topo's login. "We
don't store credentials" is not the same as "we don't process them" — the password
would transit our infrastructure, sit in memory, and be one careless log line away from
disclosure. A compromise would expose every leader who used it.

## 2. Authentication happens in the browser, against AWS

The password goes from the leader's browser straight to `cognito-idp.ap-southeast-2.amazonaws.com`.
Tokens live in a JavaScript variable, never `localStorage` or a cookie, and are gone
when the tab closes.

**Known weakness.** `USER_PASSWORD_AUTH` transmits the password to AWS, where SRP
(`USER_SRP_AUTH`) would not transmit it at all. We use the password flow because it
needs no dependencies and is known to work against this pool. Moving to SRP means
taking on `amazon-cognito-identity-js` — worth doing before wide distribution,
not worth it for a spike.

## 3. Statement ids are read from templates, never hardcoded

Ids like `important_outdoors_trails_stick_a353dc` are fetched from the template JSON
at run time. Any stream or stage works without a code change, and a template revision
does not silently write to the wrong field.

## 4. Preview before write, always

`buildPlan()` performs no I/O. The exact method, path and JSON body for every request
is rendered for review, and **Apply** stays disabled until a preview has been generated.

This is not only a safety net against bugs. A grid makes "tick everything" a single
gesture, and each ticked box is a leader personally attesting that a named child
demonstrated a skill. The friction is doing real work; do not optimise it away.

## 5. Merge, never replace

Terrain's `PUT` replaces the whole answers map. The client reads each member's existing
record, merges the new ticks into it, and sends the result — so verifications recorded
by other leaders survive.

## Open questions

**Can a leader write to a youth member's record without assist mode?**
Resolved in practice (July 2026): writes wrapped in `assume-profiles` /
`revoke-assumed-profiles` succeed, matching the official UI, so the tool now always
wraps writes and the toggle was removed. Terrain sends no body on those calls; `{}`
is also accepted. Whether unwrapped writes would also work is unknown and no longer
matters — the wrapped path is the captured, supported one.

**Should this exist at all, beyond one unit?**
Handling other units' youth data, on an undocumented API, is a governance question
rather than a technical one. See `SECURITY.md`, and talk to Branch before distributing.
