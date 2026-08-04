# flake-radar

Demo skill package used to exercise the **import** path end to end.

The archive built from this folder deliberately contains more than the skill
itself, so the import preview has something to report:

| Member | What the importer does |
|---|---|
| `SKILL.md` | Read — supplies the skill body, name, description and type (from its frontmatter). |
| `README.md` | Kept as an **evidence file** — the path is recorded, the content is not imported. |
| `scripts/collect.sh` | **Skipped.** Matched twice over: the `scripts/` path segment and the `.sh` extension. |

`scripts/collect.sh` is never decompressed, never parsed and never stored — the
importer decides on the zip's central directory, before inflating anything. The
preview lists it under "skipped" so you can see what was left out.
