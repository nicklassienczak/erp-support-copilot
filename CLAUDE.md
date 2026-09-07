# Project conventions

## Documentation is part of the change

Every code change ships its documentation in the same turn — not "later".

**What to write, in this order (stop at the first that fits):**

1. **Self-documenting code** — clear names beat a comment explaining a bad one. No comment needed.
2. **Docstring / doc-comment** on the function, class, or module — for anything a caller must know: parameters, return shape, raised errors, non-obvious constraints.
3. **`README.md`** — for anything a *new person* must know: what this is, how to install, how to run, how to run the tests, required environment variables.
4. **`docs/<topic>.md`** — only for what spans multiple files: architecture, data model, a decision and its trade-offs, a runbook.

**Always document, no exceptions:**
- Public API surface: signature, behavior, error cases.
- New or changed env vars, config keys, CLI flags, migrations → README (and `.env.example` if one exists).
- A deliberate shortcut or known limitation → an inline comment naming the ceiling and the upgrade path.
- Why, when the *why* isn't visible in the code (a workaround, a spec quirk, an ordering constraint).

**Do not document:**
- What the line already says (`i += 1  # increment i`).
- Speculative future plans, changelogs of the edit itself, or restating types the signature declares.
- Trivial edits: a typo, a rename with no behavior change, formatting.

**Keep it true.** Changing behavior means changing the docs that describe it in the same edit — a stale doc is worse than none. When you touch a documented function, re-read its docstring and the README section that mentions it.
