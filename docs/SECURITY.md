# Data handling

Written to be shown to a Group Leader or Branch privacy officer.

## What the tool is

A single static web page that adds bulk Outdoor Adventure Skills entry to Scouts
Terrain. It performs exactly the actions a leader can already perform through the
Terrain interface, using that leader's own credentials, and records the same
attributable audit trail.

## Where data goes

Nowhere new. The page runs in the leader's browser and talks to two places:

| Destination | What is sent | Operated by |
|---|---|---|
| `cognito-idp.ap-southeast-2.amazonaws.com` | branch, member number, password | AWS (Scouts' identity provider) |
| `*.terrain.scouts.com.au` | achievement records, roster reads | Scouts Australia |

There is no server belonging to this project. No analytics, no telemetry, no third
party. Member data is never transmitted to, stored by, or visible to anyone outside
Scouts' own systems.

## Credentials

- The password is posted directly to AWS over TLS and is cleared from the form on success.
- It is never written to disk, never logged, never sent to any other host.
- Tokens are held in a JavaScript variable for the tab's lifetime — not `localStorage`,
  not a cookie — and are discarded when the tab closes.
- Each leader authenticates as themselves. No shared or service accounts.

## Audit trail

Records are written under the signed-in leader's own token, so Terrain attributes
every change to the actual person, exactly as if they had used the web interface.
Verifier name, contact and date are stored against each statement.

## Data retained by the tool

None. There is no database, no cache and no export. Closing the tab discards
everything. Nothing is written to the filesystem.

## Residual risks

- **Unofficial API.** Terrain may change without notice, and the tool could break or,
  in the worst case, write something unexpected. Mitigated by previewing every request
  before it is sent, and by merging rather than replacing stored answers.
- **Bulk attestation.** The tool makes it easy to record many verifications at once.
  That is the point, and also the risk: verification is a leader's personal attestation
  about a child. Preview-then-confirm is deliberate friction and should not be removed.
- **Distribution.** If shared beyond its author, leaders must obtain it from a trusted
  source. A tampered copy could exfiltrate credentials. Publish a checksum, or host it
  somewhere Branch controls.

## Not covered

This document describes the tool. It does not constitute approval to use it. Whether
an unofficial integration may touch member records is a decision for Scouts Australia
and the relevant Branch.
