# Skills worth building

Project skills for `.claude/skills/`. Each one captures rules that are specific to this repo and easy to get wrong, so they do not have to be re-explained every session. Listed in the order they pay off.

| # | Skill | Triggers when | What it should hold | Build before |
| --- | --- | --- | --- | --- |
| 1 | `legacy-lift` | Porting any file or feature from `legacy/` | Look up the feature in `docs/legacy/` first. Checklist for every lifted file: remove Dynamic, gates and partner codes; replace backend calls with Supabase; add session and ownership checks; rename Kingdomly branding; never copy ABIs from `lib/contracts`; never copy secrets. Record what was lifted and from where | Phase 2 |
| 2 | `cobweb-contracts` | Any Solidity change | The invariants: timestamp-only liveness, fee snapshot lowerable only, fee read from the factory, identical runtime bytecode, no immutables that vary per collection, all collected value withdrawable, creation code under 24 KB. Required tests per change. How to run the bytecode-identity and size checks | Phase 1 |
| 3 | `cobweb-design` | Building or changing UI | The tokens and their values, root font scaling, 1440px `xl`, surface colour, which shared components exist and when to use them, modal pattern, copy tone | Phase 2 |
| 4 | `server-action-auth` | Writing a server action, route handler or migration | Every action goes through the session and ownership helper. Every table has row-level security. Policy patterns for owner-only and public-read. What the service role may be used for | Phase 2 |
| 5 | `mint-liveness` | Touching the mint page or freshness server | Never the browser clock; never an event; simulate then send the simulated request; no client RPC calls for shared state. The freshness API shape, cache headers and polling tiers. The test that proves an early click is blocked | Phase 6 |
| 6 | `art-pipeline` | Touching `packages/dna` or `services/render` | Job, batch and assignment data shapes. Idempotency rules: finished-batch set, one conditional update to `finalizing`. No timestamps in metadata, pinned sharp and CAR settings. The output layout. The paid or waived gate | Phase 3 |
| 7 | `add-chain` | Adding a chain | Runbook: deploy factory, verify, allowlist the codehash, set the flat fees, add chain config and RPC, register with the freshness server, smoke-test a mint | Phase 7 |

## Notes

- **Start with 1 and 2.** They cover the two places where a wrong default does the most damage: copying legacy patterns that had no auth, and breaking a contract invariant.
- **Keep each skill short.** Rules and checklists in the skill; long reference material stays in `docs/` and is linked.
- **You already have `anthropic-skills:nft-contracts`** installed. Check what it covers before writing `cobweb-contracts`, so the project skill only adds what is specific to this design.
- **A `CLAUDE.md` comes first.** The seven rules in the README belong there, since they apply to every task; skills are for the area-specific detail.
