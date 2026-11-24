# Repeatable checks

The three checks from the brief, plus a privacy check. Checks 1–3 send **text** through the
same server code that voice uses, so only speech-to-text is skipped; each was also run once by
voice in the app (see "Manual voice runs").

| Command | What it runs | Cost |
|---|---|---|
| `npm run test:checks` | Checks 1–3, plus the regressions found in manual testing, against the real Claude model (`tests/checks.live.test.ts`) | Well under 1p per run |
| `npm run check:privacy` | Two-user Firestore rules check (needs `npm run dev` running) | Free |
| `npm test` | Offline unit tests (formatting, engine, note chunking, citation lookup) | Free |

Observed results below are from runs on 24 November 2026.

---

## Check 1: available finding

**Input:** "What's the pressure in the right eye?"

| | Expected | Observed |
|---|---|---|
| Finding ids | `iop_right` only | `iop_right` |
| On screen | Right eye · Intraocular pressure · 58 mmHg (Goldmann applanation, 23:55) | Right eye · Intraocular pressure · 58 mmHg (Goldmann applanation, 23:55) |
| Spoken | Right eye, intraocular pressure: 58 millimetres of mercury. | Right eye, intraocular pressure: 58 millimetres of mercury. |

**Result: pass.** The model only chose the id; the eye, value and unit come from the case JSON.

## Check 2: unavailable finding

**Input:** "Can I see the right angle on gonioscopy?"

| | Expected | Observed |
|---|---|---|
| Finding ids | `gonio_right` | `gonio_right` |
| On screen | Right eye · Gonioscopy · Not available: No view: corneal oedema | Right eye · Gonioscopy · Not available: No view: corneal oedema |
| Spoken | Right eye, gonioscopy is not available: No view, corneal oedema. | Right eye, gonioscopy is not available: No view, corneal oedema. |
| Value invented? | No | No |

**Result: pass.**

Variant, a finding the case doesn't list: "What are the visual fields like?" Expected and observed:
no finding revealed, examiner says "That isn't available for this case." **Pass.**

Related offline test: the RAPD finding is `available: false` but still has a `value` in the JSON
("Not assessable: right pupil unreactive"). `src/case/format.test.ts` checks that this value is never shown or spoken.

## Check 3: the citation supports the revision point

**Input:** a scripted answer that covers every key point except treating the fellow eye
(it handles the sulfonamide allergy, times pilocarpine correctly, stops chlorphenamine), then
the follow-up "Why might you treat the left eye as well?" answered with "I wouldn't treat the
left eye. The pressure there is normal, so it isn't affected."

| | Expected | Observed |
|---|---|---|
| Gap found | Treating the fellow (left) eye | "Fellow eye with narrow angle is at risk; needs prophylactic laser iridotomy, not dismissed" |
| Pages retrieved | Include page 6 (prophylactic LPI in the fellow eye) | Run 1: **7, 7, 10, 6, 4** (`p7-2`, `p7-3`, `p10-5`, `p6-8`, `p4-6`). Final run: **7, 10, 6, 7, 4, 5** (`p7-2`, `p10-5`, `p6-8`, `p7-9`, `p4-6`, `p5-13`). The gap is phrased by the model, so the query and retrieved set vary slightly; the cited passage was `p6-8` both times |
| Passage cited | A fellow-eye passage (`p6-8`, `p7-2`, `p5-13` or `p6-7`) | `p6-8`, **page 6** |
| Excerpt | Word for word from the cited page | "Prophylactic LPI in the fellow eye, because without treatment around 40 to 50% of fellow eyes have an attack within 5 to 10 years" (matches page 6 of the PDF) |
| Supports the point? | Yes | Yes. Point: "You were wrong to dismiss the left eye because its pressure is normal. A narrow angle in the fellow eye puts it at real risk, so you should plan prophylactic laser peripheral iridotomy there too, since long-term pilocarpine is not an adequate alternative." |

**Result: pass.** The distractor pages (7 and 10 cover iridotomy in general) were retrieved but not cited.

How "supported" is decided: the model must quote the chosen passage word for word. Code then
checks the quote is in that retrieved passage (`locateExcerpt` in `src/note/chunk.ts`) and takes the
cited page from where the quote is printed, not from the model. An unverifiable quote is shown
to the trainee as "no support found".

Variant, no support in the note: the gap "Long-term control of her systemic hypertension".
Expected: unsupported. Observed: `unsupported`, reason "None of the reference passages address
systemic hypertension…", retrieved `p5-14`, `p5-10`, `p5-12`, `p6-10`, `p1-4`. **Pass.**

## Privacy check

`npm run check:privacy` signs up two users in the Auth emulator and calls Firestore's REST API with each user's token.

| Request | Expected | Observed |
|---|---|---|
| A writes own attempt | 200 | 200 |
| A reads own attempt | 200 | 200 |
| B reads A's attempt | 403 | 403 |
| B lists A's attempts | 403 | 403 |
| B writes into A's attempts | 403 | 403 |
| Signed out, reads A's attempt | 403 | 403 |

## Manual voice runs

The same checks done by voice in Chrome, taken from saved attempts (the transcript shows what
speech-to-text heard).

| Check | Heard | Examiner said / showed | Result |
|---|---|---|---|
| Available | "What's the pressure in the right eye?" | Right eye, intraocular pressure: 58 millimetres of mercury | Pass |
| Available, no eye given | "What's the pressure?" | Right 58, left 18 mmHg | Pass |
| Unavailable | "Right Gonioscopy" | Right eye, gonioscopy is not available: No view, corneal oedema | Pass |
| Unavailable, value trap | "Is there an RAPD?" | …not available: Right pupil fixed, so the test cannot be interpreted (the JSON's `value` was not used) | Pass |
| Citation | Diagnosis "Acute angle closure, give IV acetazolamide", follow-up answered "Give IV acetazolamide" | Point on checking sulfonamide allergy first. Excerpt "Check for sulfonamide allergy, kidney disease, low potassium and sickle cell disease before giving it." **Page 6**. The passage (`p5-14`) runs over pages 5–6, and the quote is printed on page 6 | Pass |
| Citation | Diagnosis "I don't know", follow-up answered "Conjunctivitis, give antibiotic drop" | Point on the fixed mid-dilated pupil of angle closure. Excerpt from page 4, Signs | Pass |

## Bugs found by manual testing, and fixed

Deliberately trying to break it found these. Each is now a live check in `tests/checks.live.test.ts`.

| Said | Was | Now |
|---|---|---|
| "Is there anything wrong with the left eye?" | Revealed all 13 left and both-eye findings at once | "Which examination would you like?…", nothing revealed |
| "And what about the left eye?" (after right gonioscopy) | Generic prompt: no memory of the previous request | Left gonioscopy |
| "Rite Thunder" (misheard "right fundus") | **Revealed the right IOP**, a guess | Nothing revealed; asked again. "fundus" added as a speech keyterm |
| "What are her visual fields?" | History prompt (a regression from the previous fix) | "That isn't available for this case" |
| "Corneal thickness" | Revealed the cornea descriptions | Not available |

Final live run: 13/13 checks pass. The four "never guess" phrasings passed 3 runs out of 3.
