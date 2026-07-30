# Terrain API — observed behaviour

Everything here was derived from captured browser traffic against a live Terrain
session in July 2026. **This is not an official or documented API.** It has no
versioning policy and no deprecation notices. Assume it can change without warning.

Marked `[captured]` where the request and response were observed directly, and
`[inferred]` where the endpoint comes from the [Topo](https://github.com/NomisNostab/Topo-Blazor)
project's source but has not been seen on the wire here.

## Hosts

| Host | Purpose |
|---|---|
| `cognito-idp.ap-southeast-2.amazonaws.com` | authentication |
| `members.terrain.scouts.com.au` | profiles, unit rosters, assist mode |
| `achievements.terrain.scouts.com.au` | achievement records, submissions |
| `templates.terrain.scouts.com.au` | OAS stage templates (public JSON) |

## CORS

Every achievements response carries:

```
access-control-allow-origin: *
access-control-allow-headers: authorization,content-type
access-control-allow-methods: GET,PATCH,POST,PUT,OPTIONS,DELETE
```

Wildcard origin plus an allowed `authorization` header means a browser app served
from any origin can call the API directly. No proxy is required. This is the single
fact that determines this project's architecture — see `DECISIONS.md`.

## Authentication `[inferred]`

`POST https://cognito-idp.ap-southeast-2.amazonaws.com/`

```
x-amz-target: AWSCognitoIdentityProviderService.InitiateAuth
content-type:  application/x-amz-json-1.1
```

```json
{ "AuthFlow": "USER_PASSWORD_AUTH",
  "ClientId": "<one of four>",
  "AuthParameters": { "USERNAME": "qld-1234567", "PASSWORD": "…" } }
```

The username is `{branch}-{memberNumber}`. Four app client ids exist; try each
until one is accepted. The response `AuthenticationResult.IdToken` is then passed
as a bare `authorization` header (no `Bearer ` prefix) on all Terrain calls.

Refresh uses `AuthFlow: REFRESH_TOKEN_AUTH` with `REFRESH_TOKEN` and `DEVICE_KEY: null`.

## Templates `[captured]`

```
GET /oas/{stream}/tree.json
GET /oas/{stream}/{stage}/latest.json
GET /oas/{stream}/{stage}/{version}.json
```

Statements live at `document[].input_groups[].inputs[]`:

```json
{ "id": "important_outdoors_trails_stick_a353dc",
  "type": "verifiable_checkbox",
  "label": "I know why it is important to stick to trails when outdoors." }
```

`type` is `verifiable_checkbox` (needs a verifier), `checkbox` (e.g. `logbook_up_to_date`,
no verifier fields) or `file_uploader`.

**Template versions are per stage, not global** — `oas/bushcraft/1` was version 2 while
`oas/bushwalking/1` was version 1. When editing an existing record, fetch the *pinned*
version the record was created against rather than `latest`, or statement ids may drift.

## Achievement lifecycle `[captured]`

```
(none) ──POST /members/{memberId}/achievements──────────────────▶ draft_review
draft_review ──PUT /members/{memberId}/achievements/{id}────────▶ draft_review
draft_review ──POST …/achievements/{id}/submit-on-behalf────────▶ pending_review
```

### Create — `POST /members/{memberId}/achievements` → `200`

```json
{ "achievement_meta": { "stage": 1, "stream": "bushcraft", "branch": "bushcraft" },
  "achievement_type": "outdoor_adventure_skill",
  "template": "oas/bushcraft/1",
  "version": 2,
  "section": "cub",
  "answers": { },
  "uploads": [] }
```

Returns the created record including `id` and `status: "draft_review"`.

### Update — `PUT /members/{memberId}/achievements/{achievementId}` → `200`

**Full-document replace, not a patch.** The `answers` map must contain everything
that should remain set; anything omitted is dropped. Read the record first, merge,
then send the whole thing.

The response echoes `last_updated`; send it back on the next update. This looks like
optimistic concurrency, though we have not tested a conflicting write.

### Submit — `POST /members/{memberId}/achievements/{achievementId}/submit-on-behalf` → `204`

```json
{ "type": "review", "unit_id": "…", "submitted_by": "…" }
```

`submitted_by` is the **signed-in leader's own** member id (from
`profiles[0].member.id` in the `/profiles` response), not the youth member's.
The plain `…/submit` endpoint (no `-on-behalf`, no `submitted_by`) returns
`403` for a leader token even inside assist mode — observed July 2026. It is
presumably what a member submitting their own record uses.

### Answers schema

Each ticked statement contributes up to five keys:

```json
{ "match_strike_fdc180": true,
  "match_strike_fdc180_verifierType": "member",
  "match_strike_fdc180_verifierName": "Jeremy Ford",
  "match_strike_fdc180_verifierContact": "0412219940",
  "match_strike_fdc180_verifiedDate": "29/07/2026" }
```

`verifierType` is `member` for a Scout member, and the date is `DD/MM/YYYY`.
Plain checkboxes carry only the boolean. `file_uploader` is an array.

## Reading records

```
GET /members/{memberId}/achievements?type=outdoor_adventure_skill   [captured]
GET /units/{unitId}/submissions?status=pending|finalised            [captured]
GET /units/{unitId}/achievements?type=…&stream=…&branch=…&stage=…   [inferred]
```

`submissions` returns:

```json
{ "results": [ {
    "achievement": { "id": "…", "type": "outdoor_adventure_skill",
                     "achievement_meta": { "stage": 2, "stream": "aquatics", "branch": "aquatics" } },
    "submission":  { "id": "…", "type": "award", "date": "…", "status": "pending", "actioned_by": [] },
    "unit_permissions": { "write": false },
    "member": { "id": "…", "first_name": "…", "last_name": "…" } } ] }
```

`submission.type` is `review` (leader sign-off) or `award` (final).

## Members service `[inferred]`

```
GET  /profiles
GET  /units/{unitId}/members     [captured]
GET  /patrols/{patrolId}/members
POST /members/{memberId}/assume-profiles
POST /revoke-assumed-profiles
```

`GET /units/{unitId}/members` response entries (observed July 2026):

```json
{ "results": [ {
    "id": "…", "member_number": "…", "first_name": "…", "last_name": "…",
    "status": "active", "date_of_birth": "YYYY-MM-DD",
    "groups": [ { "id": "…", "name": "…" } ],
    "unit":   { "id": "…", "section": "cub", "duty": "adult_leader", "unit_council": true, "group_id": "…" },
    "patrol": { "id": "…", "name": "Cub Leaders", "duty": "member" } } ] }
```

Leaders carry `unit.duty` of `"adult_leader"` and/or sit in a patrol named like
"Cub Leaders" — sometimes only one of the two. Their `patrol.duty` is plain
`"member"`; youth duties (`patrol_leader`, `assistant_patrol_leader`) live on
`patrol.duty` and do not indicate an adult.

`assume-profiles` is the "Manage achievement pathways" flow in the Terrain UI,
which carries a 30-minute server-side timer. Whether it is required in order to
write to another member's record is **an open question** — see `DECISIONS.md`.
With assist mode on, achievement writes succeed (`200`) — observed July 2026;
without it they remain untested. Terrain sends `assume-profiles` /
`revoke-assumed-profiles` with **no request body**; an empty `{}` is also
accepted (`204`).

In `/profiles`, `profiles[0].member.id` is the signed-in member `[captured]` —
used as `submitted_by` for submit-on-behalf.

## Known unknowns

- Rate limits. The client spaces writes 400 ms apart as a precaution.
- Whether writes to another member work *without* an assumed profile
  (with one, they do).
- The `/profiles` response schema beyond `profiles[0].member.id`
  (still walked heuristically for units).
- Approve and award transitions — not yet captured.
