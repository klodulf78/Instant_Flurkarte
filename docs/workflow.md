# Team Workflow & Branch Strategy

Repo: https://github.com/klodulf78/Instant_Flurkarte

## Branches
- `main` — shared foundation: Skybridge app + shared contract + docs (merge via PR)
- `karl` — NRW adapter (Karl)
- `dokeun` — Berlin adapter (Dokeun)
- `sasha` — Thüringen adapter (Sascha)

## Golden rule
Everyone implements the **same** interface: `FlurkarteAdapter` in
`src/shared/contract.ts` (see `shared-contract.ts`). One input, one output —
so the three adapters merge cleanly and the MCP tool routes by Bundesland.

## Order
1. **Karl** establishes `main`: scaffold Skybridge + add `docs/` + shared
   contract → push to `main`.
2. Everyone syncs: `git checkout <your-branch> && git merge main`.
3. Each builds their adapter on their own branch, against the shared interface.
4. Merge adapters into `main` via PR. **NRW is the reference implementation.**

## Don't
- **Don't run the Node project from iCloud Drive** — it breaks `node_modules`
  sync. Clone to a local path, e.g. `~/Developer/Instant_Flurkarte`.
