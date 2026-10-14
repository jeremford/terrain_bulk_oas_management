# `oas-statements.json` — OAS statement export

A single flat JSON file listing every Outdoor Adventure Skills statement
("I can…"), with its assessment guidance, for all nine OAS streams at stages
1–3. Built for machine consumption: one row per statement, no nested structure
to unpack, suitable for populating a spreadsheet or feeding to an LLM.

Contains **no personal data** — it is a flattened copy of the public syllabus
templates, nothing more.

## Source

The data comes from Scouts Terrain's public template host. No login or token is
required; these URLs serve anonymous JSON:

- Template (latest version): `https://templates.terrain.scouts.com.au/oas/{stream}/{stage}/latest.json`
  — e.g. <https://templates.terrain.scouts.com.au/oas/bushcraft/1/latest.json>
- Pinned version: `https://templates.terrain.scouts.com.au/oas/{stream}/{stage}/{version}.json`
  — e.g. <https://templates.terrain.scouts.com.au/oas/bushcraft/1/2.json>
- Stream overview: `https://templates.terrain.scouts.com.au/oas/{stream}/tree.json`
  — e.g. <https://templates.terrain.scouts.com.au/oas/bushcraft/tree.json>

These templates back [Scouts Terrain](https://terrain.scouts.com.au) itself.
The export uses `latest.json`, so it reflects the current syllabus at
generation time (see `generated_at` and the per-row `template_version`).

Streams covered: bushcraft, bushwalking, camping, alpine, aquatics, boating,
cycling, paddling, vertical.

## Regenerating

From a checkout of
[jeremford/terrain_bulk_oas_management](https://github.com/jeremford/terrain_bulk_oas_management)
(Node 20+, no dependencies):

```bash
npm run export                                   # all streams, stages 1-3
node scripts/export-statements.mjs --stages 1,2,3,4
node scripts/export-statements.mjs --streams bushcraft,camping --out subset.json
```

Writes `oas-statements.json` to the current directory. The file is derived
data and is not committed — regenerate it when needed.

For a human-readable version, `npm run export:md` also renders the JSON as
`oas-statements.md` — statements and guidance grouped by stream, stage and
group, without ids.

## Structure

```json
{
  "generated_at": "2026-08-20T…",
  "source": "https://templates.terrain.scouts.com.au (public OAS templates, latest versions)",
  "streams": ["bushcraft", "…"],
  "stages": [1, 2, 3],
  "statement_count": 424,
  "statements": [
    {
      "stream": "bushcraft",
      "stage": 1,
      "template_version": 2,
      "group": "Plan>",
      "order": 1,
      "id": "important_outdoors_trails_stick_a353dc",
      "statement": "I know why it is important to stick to trails when outdoors.",
      "guidance": "The youth member should be able to talk about and demonstrate…",
      "verifiable": true
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `stream` | OAS stream, lower-case (`bushcraft`, `paddling`, …) |
| `stage` | Stage number the statement belongs to |
| `template_version` | Version of the template it was read from (versions are per stream/stage, not global) |
| `group` | Section heading, verbatim from the template — Terrain uses `Plan>`, `Do>`, `Review>` |
| `order` | 1-based position within the stage, for stable sorting |
| `id` | Terrain's statement id — the key used in achievement `answers` maps |
| `statement` | The "I statement" text shown to youth members |
| `guidance` | Assessment guidance Terrain shows behind its info icon (may be empty, may contain newlines) |
| `verifiable` | `true` if Terrain records a verifier against this statement; `false` for plain checkboxes |

## Using it

- **Spreadsheet:** each entry in `statements` is one row; the field names are
  the column headers. In Excel, Data → Get Data → From File → From JSON, drill
  into `statements`, then "To Table" → expand. Sort by `stream`, `stage`,
  `order` to reproduce syllabus order.
- **LLM ingestion:** hand over the whole file; it is self-describing. `id` is
  the stable join key back to Terrain achievement records.

## Caveats

- Unofficial: this is a community export, not a Scouts Australia publication.
  The syllabus text belongs to Scouts Australia.
- Templates change without notice and versions are pinned per stream/stage —
  an existing Terrain record may reference an older `template_version` whose
  ids differ from this export.
