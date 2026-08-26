# Learning Quest — Handoff Addendum: Term 1 Exam-Review Feature

**Read this alongside the main `HANDOFF.md`** (§1-10 there still apply — architecture, git workflow, calibration process, sandbox limitations, etc. are all unchanged). This addendum covers everything built in the session(s) that added exam-review content and fixed several related bugs, since it's a large enough chunk of work to warrant its own reference.

**Last updated:** end of session containing commit `2c2fb55` ("Fix silent sign-in failure feedback from the account popover")

---

## 1. What this feature is

The user's son (Grade 4, Makati, DepEd/MATATAG curriculum) had a Term 1 exam coming up. He uploaded photos of his official "pointers to review" lists for English, MAPEH, and EPP. We:

1. **Researched** each pointer against the actual MATATAG curriculum (competency codes, DepEd Budget of Work) to confirm the lists were legitimate and figure out exactly what to teach — not just matched by title.
2. **Built new content and upgraded existing content** so every single pointer from all three subjects is now covered in-game.
3. **Added a reusable engine feature** ("pool" topics) so review content can draw from a larger question bank each attempt, and gave these topics a distinct visual treatment (badges) so the user's son can see at a glance which topics are exam-relevant and which he's already cleared.
4. **Found and fixed several real bugs** along the way, some pre-existing, some introduced by this feature and caught quickly.

**Current totals: 8 subjects / 65 topics / 840 questions / 19 exam-review ("pool") topics.**

---

## 2. The `pool` topic feature (engine)

Any topic in `SUBJECTS` can now optionally have `pool: N` (currently always `pool: 10` in practice). This is fully backward-compatible — a topic without `pool` behaves exactly as before.

### What it does
- The topic's `quiz` array holds MORE questions than a battle actually uses (all exam-review topics have 20).
- `buildQuizOrder(npc)` (near `shuffleArr`) checks `npc.pool`: if set and the quiz has more questions than the pool count, it shuffles all question indices and takes the first `pool` of them. Called at battle start AND on mid-battle wraparound (if a battle runs long), so a replay or a long session draws fresh subsets.
- Everything downstream (progress display, "question X of Y") already worked off `pokeState.quizOrder.length`, not `npc.quiz.length`, so no other battle-flow code needed to change.
- `npc.pool` and `npc.topicKey` (see §3) must be threaded through wherever an `npc` object is constructed from a `topic` — there are **two** such construction sites: `pickLocalMapNpc()` (the main rendered-map path) and the legacy `owNpcList` builder inside the procedural-overworld fallback (only used if a location has no rendered art — shouldn't fire for any current Windy Plains location, but is kept correct for safety/future-proofing).

### The badges
- `!` badge: animated (pulse + glow ring, `prefers-reduced-motion`-aware), shows on:
  - **Region map**: inline right after the location's `Name - SUBJECT` text, if that location has ANY exam-review topic not yet mastered.
  - **Local map**: corner badge on each individual NPC marker, if THAT topic is exam-review and not yet mastered.
- `✓` badge: static green, replaces the `!` once mastered — see §3 for what "mastered" actually checks (this is where a real bug lived).
- CSS classes: `.exam-review-badge` (base, animated), `.exam-review-badge-inline` (region-map sizing/position variant), `.exam-review-badge-done` (green, cancels animation).

---

## 3. EXAM_PROGRESS — why it exists (read this before touching mastery logic)

**The bug this solves:** Several exam-review topics (e.g. `masscount`, `culture`, `personalhealth`) are **upgrades of pre-existing topics** that a player may have already 3-starred under the OLD, smaller 10-question set — long before the topic had any `pool` or exam-review status. If we used the regular `PROGRESS` star count to decide "is this exam-review topic mastered," a player's old mastery would incorrectly show the green `✓` even though they'd never actually attempted the new, larger question pool.

**The fix:** a second, separate tracker.

```js
let EXAM_PROGRESS = {};  // sparse object, keyed by TOPIC KEY (not subject+index like PROGRESS)
// e.g. { verbtenses: 3, outline: 1, sinukwanfestival: 0 }
```

- Only exam-review topics ever get an entry. Everyone starts at `{}` — so ANY topic that had prior `PROGRESS` mastery from before it became exam-review correctly shows `!` again until actually re-cleared under the new pool.
- Updated in `endPokeBattle()`, right next to (but separate from) the existing `PROGRESS` update: `if(npc.pool && npc.topicKey){ ...update EXAM_PROGRESS[npc.topicKey] if higher... }`.
- Persists to `localStorage` under key `lqh_exam_progress` (`saveExamProgressLocal`/`loadExamProgressLocal`, called at boot alongside the `PROGRESS` equivalents).
- Rides along in the SAME Firestore document as `PROGRESS` (added as an `examProgress` field in `cloudSyncProgress()`'s payload) — no separate network round-trip.
- **Sign-in merge behavior is intentionally different from `PROGRESS`:** `EXAM_PROGRESS` auto-merges by taking `Math.max` per topic key, silently, no confirmation prompt. This was a deliberate choice — the stakes are much lower (no leaderboard tie-in, no visible star count elsewhere), so a quiet best-of-both merge was judged better than adding a second conflict dialog on top of the one `PROGRESS` already has.

**Mastery check functions (know which one to use where):**
- `regionLocationMastered(subjectKey)` — checks regular `PROGRESS`, drives the pre-existing `⭐⭐⭐` badge on the region map. Unrelated to exam-review; don't confuse with the next one.
- `examReviewMastered(subjectKey)` — checks `EXAM_PROGRESS` against every pool topic in that subject; returns `false` if the subject has zero exam-review topics (nothing to master) or if any pool topic isn't yet at 3 in `EXAM_PROGRESS`. Drives the green-check swap on the region map.
- Local map badge checks `EXAM_PROGRESS[t.key] >= 3` directly per-NPC, no helper function needed since it's a single lookup.

---

## 4. A second, unrelated bug found and fixed in this area: `applyProgressArray`

**Separate from the EXAM_PROGRESS issue above.** While adding new topics to already-completed subjects (e.g. adding 2 new EPP topics to a subject the user's son had already 100% mastered), the region map started showing `⭐⭐⭐` (full mastery) even though the new topics were unplayed.

**Root cause:** every place that loaded saved `PROGRESS` from `localStorage` or Firestore did a **wholesale array replace**: `PROGRESS[subj] = savedArray`. A save made before new topics existed has a SHORTER array. Replacing wholesale silently shrinks `PROGRESS[subj]` back down to the old length — the new topics' slots don't just start at 0, they **vanish from the array entirely**, so `.every(s=>s>=3)` never even sees them and reports mastered.

**Fix:** new helper `applyProgressArray(subjectKey, savedArr)` copies values onto the LIVE, correctly-sized array by index, never resizing it. Used in all three places that used to do the naive assignment: `loadProgressLocal()`, the cloud-load branch in `handleAuthStateChange()`, and (before it was removed — see §5) `resolveProgressConflict()`.

**If you ever add more per-topic arrays keyed by subject+index in the future, use this same pattern or you will hit this exact bug again.** `EXAM_PROGRESS`'s key-based (not index-based) shape was deliberately chosen partly to sidestep this whole class of bug — see the design discussion in the git history around commit `7d84097`.

---

## 5. Sign-in / progress-conflict flow — now much simpler than it was mid-session

This flow churned a few times this session. Where it landed:

- **Cloud always wins on sign-in.** No merge picker, no "keep local/keep cloud" choice. This is a deliberate simplification requested by the user, reversing an earlier (also user-requested) more complex merge-prompt system that existed briefly.
- **One confirmation, only when it matters:** `handleSignInClick()` checks `sumProgressStars(PROGRESS) > 0` BEFORE calling Firebase's `signIn()`. If there's real local progress at stake, `confirmSignInOverwrite()` shows a modal ("Signing in will load your account's saved progress and replace this device's local progress... This cannot be undone" / Sign In / Cancel) and only proceeds to the actual Google sign-in if confirmed. A fresh device with zero local progress skips the prompt entirely.
- **Already-authenticated sessions** (app reload while still logged in from a previous visit) apply cloud data automatically and silently — no prompt, since there was no local-only progress at risk of surprise loss in that case.
- **Removed as dead code:** `mergeProgressMax`, `promptProgressConflict`, `resolveProgressConflict` — all fully deleted, not just unused. If you see references to these in old git history/diffs, that's expected; they no longer exist as of `ff0174a`.
- `EXAM_PROGRESS` is NOT part of this confirmation flow at all — it always silently max-merges regardless (see §3).

---

## 6. New/changed NPCs — full sprite and location reference

### Standing Stones (English) — 15 NPCs total (was 11)
| # | Topic | Sprite | Status |
|---|---|---|---|
| 11 | Simple Tenses of Verbs | `stablehand01` | New |
| 12 | Outline | `woodlandranger01` | New (also used at Traveler's Camp — different location, fine) |
| 13 | Friendly Letter | `fisherman01` | New |
| 14 | Visual Elements: Lines, Colors, Shapes | `tavernkeeper01` | New |

Plus topics 0, 2, 3, 4 (Noting Details, Reality & Fantasy, Mass & Count Nouns, Singular & Plural Nouns) upgraded to `pool:10` — same NPCs as before (`youngadventurer`, `grovekeeper01`, `elventrader01`, `forestherbalist01`), only their `quiz` arrays grew and content was revised.

### Millbrook Farm (EPP) — 9 NPCs total (was 7)
| # | Topic | Sprite | Status |
|---|---|---|---|
| 7 | Seksuwal at Aseksuwal na Pagpaparami ng Halaman | `villagebaker01` | New |
| 8 | Pag-aani at Pagbebenta ng mga Inaning Tanim | `farmersdaughter01` | New (also at Standing Stones — different location, fine) |

Plus topics 0, 1, 4, 5, 6 (both computer topics, all three original agriculture topics) upgraded to `pool:10`.

### Traveler's Camp (MAPEH) — 8 NPCs total (was 6)
| # | Topic | Sprite | Status |
|---|---|---|---|
| 6 | Creative Works in the Sinukwan Festival | `mountainguard01` | New |
| 7 | Move, Aim, and Score: Target Game Skills | `woodlandranger01` | New (reused from Standing Stones) |

Plus topics 0, 2 (Culture & Cultural Identity, Personal Health Care — the latter absorbed the "Family Wellness" pointer content) upgraded to `pool:10`.

### Sprite pool status
- `miner01` — still unused anywhere. Last one genuinely free.
- `villagebaker01`, `mountainguard01` — now both used (see above). No longer free.
- No other unused sprites remain in the 30-sprite pool. **Any future new NPC needs either sprite reuse across a different location, or new art the user would need to supply/commission** — this came up mid-session (Visual Elements topic) and `tavernkeeper01` (reused from elsewhere) was the resolution.

All three locations have been through at least one calibration round-trip with the user this session; positions should be considered final unless the user says otherwise.

---

## 7. MATATAG accuracy — what's verified and what to watch

A full pass was done cross-referencing all 19 exam-review topics' actual QUESTION TEXT (not just titles) against the MATATAG competencies identified in the original research phase.

**Result: 17 of 19 confirmed tight. 2 were found drifting and revised:**
- **Singular & Plural Nouns** — was 100% irregular-plural spelling questions (child→children, mouse→mice...). The actual competency covers regular AND irregular plurals plus general singular/plural usage. Revised to a genuine mix (9 regular, 9 irregular-ish, 2 usage/identification).
- **Visual Elements: Lines, Colors, Shapes** — was heavily color-psychology-flavored ("warm colors make you feel excited"), which is closer to an Arts framing than the actual English viewing-strand competency (EN4VR-I-1/I-2: identifying visual elements and DERIVING MEANING/PURPOSE from them). Revised to focus on identification + meaning-derivation, with a couple of real/fantasy-image questions folded in since that's the immediately adjacent competency in the same viewing strand.

**One fact claim was independently verified via web search, not just asserted:** the Sinukwan Festival topic's question stating "Aring" means "king" — confirmed accurate against multiple sources (Wikipedia, academic paper, festival-history sites all translate "Aring Sinukwan" as "King Sinukwan").

**If more exam-review content is added later, apply the same standard:** don't just match a topic title to a pointer — pull the actual question text and check it against the specific competency wording, the way this pass did. Titles can look right while content drifts.

---

## 8. Sanity-testing pattern used throughout this session

For every piece of new logic (pool sampling, EXAM_PROGRESS merge, applyProgressArray, the sign-in confirmation gate), a small standalone Node script was written to exercise the actual logic in isolation with `console.assert`, BEFORE trusting it in the full app. This caught real issues before they shipped (e.g. confirming `applyProgressArray` genuinely doesn't shrink the array, confirming `EXAM_PROGRESS` starts at 0 regardless of old `PROGRESS`). **Recommend continuing this pattern** for any future logic (not just content) changes — it was cheap and caught things a syntax check alone wouldn't.

---

## 9. Known remaining gaps (pinned, not yet fixed)

1. **Silent cloud-save failures.** `cloudSyncProgress()` never checks `result.ok` from `window.LQFirebase.saveProgress(...)`. A failed Firestore write (network blip, permission issue, quota) is invisible to the player. **Not a data-loss risk** — `saveProgressLocal()`/`saveExamProgressLocal()` always run first at every call site — but a signed-in player could believe they're cross-device-synced when a background write silently failed. Discussed a "quiet sync-status indicator near the account button" as the likely fix shape, not yet implemented.
2. *(Previously also pinned: silent sign-in failure from the popover — this one WAS fixed this session, commit `2c2fb55`. Only gap 1 above remains open.)*

---

## 10. Quick reference: exam-review topic keys (for future lookups)

```
English: notingdetails, realityfantasy, masscount, singularplural,
         verbtenses, outline, friendlyletter, visualelements
EPP:     bahaginangcomputer, operasyongcomputer, panimulasaagrikultura,
         kagamitansapagsasaka, pangangalagangHalaman,
         pagpaparamingHalaman, paganiatpagbebenta
MAPEH:   culture, personalhealth, sinukwanfestival, targetgames
```

All 19 have `pool: 10` and exactly 20 questions in their `quiz` array. Content integrity check should always report these numbers unless intentionally changed: **8 subjects, 65 topics, 840 questions total.**
