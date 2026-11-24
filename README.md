# Eye Academy voice viva

A short spoken ophthalmology viva on case EA-VIVA-001, built with TanStack Start, Firebase Auth and Firestore.
The trainee asks for findings aloud, gives a diagnosis, answers one follow-up, and gets a revision point
cited from the glaucoma reference note.

- [Run it](#run-it)
- [What works and where I stopped](#what-works-and-where-i-stopped)
- [Model choice and responsiveness](#model-choice-and-responsiveness)
- [Three repeatable checks](#three-repeatable-checks) (full results in [CHECKS.md](CHECKS.md))
- [Handover](#handover)
- [One improvement](#one-improvement-hands-free-turn-taking)

## Run it

**Needs:** Node 22+, Java 21+ (for the Firebase emulators), Chrome or Edge, a Deepgram key and an Anthropic key.

```sh
npm install
cp .env.example .env.local      # then add DEEPGRAM_API_KEY and ANTHROPIC_API_KEY
npm run dev                     # Firebase Auth + Firestore emulators and the app
```

Open the URL Vite prints (usually http://localhost:3000). Create an account: accounts only exist in the local
Auth emulator. The Emulator UI is at http://localhost:4000. Data persists between runs in `.emulator-data/`.

The emulators need Java 21. `npm run dev` uses `JAVA_HOME` if it is set. Otherwise it looks for a JDK 21+
unpacked under `~/.local/share`.

**First run is slower.** Two one-off downloads happen automatically:
- `npm run dev` downloads the Firebase emulators the first time (about 140 MB, mostly the Firestore emulator).
- The first revision point downloads the local embedding model (`bge-small-en-v1.5`, about 130 MB) and caches it
  under `node_modules`. That first revision point takes noticeably longer. After that it's quick.

Data is saved to `.emulator-data/` when you stop with **Ctrl+C**. If the process is killed instead, that session's data isn't kept.

| Command | Purpose |
|---|---|
| `npm test` | Offline unit tests (77) |
| `npm run test:checks` | The three checks, plus regressions found in manual testing, against the real model (22) |
| `npm run check:privacy` | Two-user Firestore rules check (with `npm run dev` running) |
| `npm run prepare:note` | Rebuild `data/note-chunks.json` from the PDF |

## What works and where I stopped

Built in about 3 hours over one session, not counting reading the brief and planning beforehand.

**Works**
- Sign in, start a viva, hear the opening prompt.
- **Layout.** History is always on screen (left). The conversation has its own scrolling region that follows
  the newest message, with push-to-talk docked underneath. Revealed findings sit in a right panel that
  collapses to a slim rail.
- **Voice findings.** Hold the button (or Space) and ask for findings. The examiner reads each finding back
  and shows it with the correct eye, value and units. A listed but unavailable finding is read back with
  its reason. A test the case doesn't list is named as not available ("Visual fields: not available for this case"),
  including when it's asked for alongside findings that are listed. Follow-ons work
  ("right gonioscopy" → "and the left?"). A request that names nothing ("is there anything wrong with the left eye?")
  gets "Which examination would you like?" rather than revealing the whole examination. An unclear or misheard
  request reveals nothing, so the trainee is asked again.
- **Turn-taking.** A status panel shows whose turn it is (colour, text and icon): *Your turn → Listening →
  Examiner thinking → Examiner speaking*. The mic is disabled while the examiner thinks or speaks.
- **Follow-up.** After the diagnosis (button, or say "I'm ready to give my diagnosis"), the examiner asks
  **one** spoken follow-up that responds to the trainee's answer, as the brief asks. I chose to aim it at the most important
  key point they missed or got wrong. A diagnosis given without announcing it ("I think this is angle closure, I'd give…")
  is taken as the answer rather than asked for again. While answering, "can you repeat the question?" repeats it, and an
  explicit request for a finding is answered, so neither is mistaken for the answer. The trainee's answer to the
  follow-up ends the viva. Anything wrong in that answer is picked up by the revision point, not by a second question.
- **Saved attempts.** The attempt is saved after every turn. After a refresh it reopens with its transcript and
  revealed findings, and an unfinished viva carries on without the examiner repeating itself. Attempts are private
  to their owner. Another user's attempt URL shows "Attempt not found". A load failure (e.g. emulators not running) says so instead.
  The attempts list separates in-progress vivas (with Continue) from completed ones, which show what to revise and
  can expand the full revision point in place.
- **Revision point.** After the viva, one revision point with a page number and a word-for-word excerpt
  from the reference note, or a clear "no support found".
- **Recovery.** A text box takes the place of voice (noisy room, no mic). An empty transcript gets "Sorry, I didn't
  catch that" and doesn't count as a turn. API errors show a message without losing the attempt. "Repeat last" replays the examiner.

**Where I stopped / known gaps**
- The server routes (`/api/transcribe`, `/api/speak`, server functions) don't verify the Firebase ID token.
  That's acceptable for a local demo, but a deployed version must, because they spend API credit.
- A turn is saved when the examiner's reply arrives. Refreshing while the examiner is thinking loses that one
  turn. Two tabs on the same attempt overwrite each other (last write wins).
- Speech-to-text still mishears some drug names despite keyterms ("apraclonidine" → "apradunavol", "acetazolamide" → "acetazolol").
  The follow-up and revision steps coped, because Haiku reads the intent, but a transcript shown to a trainee
  could be corrected against a drug list.
- The revision point is generated once per attempt. There's no retry when a quote fails verification: it shows "no support".
- The voice is Deepgram's default US voice (`aura-2-thalia-en`). It can be changed with `DEEPGRAM_VOICE`.
- Tested in Chrome on macOS. Audio streaming uses Media Source Extensions, with a plain `<audio>` fallback where
  MP3 streaming isn't supported (e.g. some Safari versions). The fallback is slower and hasn't been tested.
- **UI polish I'd do next.** I kept the interface functional rather than finished:
  - Consistent primary and secondary button styles. At the moment each button is styled where it's used, so similar
    actions don't always look alike.
  - Layout tweaks: spacing and hierarchy across the three panes, and the attempts list.

**Beyond the brief (choices to discuss)**

These go past what the brief asks for. They're kept small, and listed here so each is a deliberate, visible choice:
- **"Which examination would you like?"** for a request that names nothing ("is there anything wrong with the left eye?").
  The brief only says the trainee can ask for findings. This withholds findings until one is named, because asking
  systematically is the skill a viva tests.
- **Follow-on requests** ("and the left?") resolve against the previous request.
- **Recovery aids:** a text box for noisy rooms or no mic, "Repeat last", and Space as push-to-talk.
- **"Last voice turn: N ms"** on screen. This is a measuring aid for the brief's latency question, not something a trainee needs.
- **The retrieved passages under each revision point,** distractors included. This is evidence for the citation check; a trainee-facing version might hide it.
- **The attempts list** grouped into in progress and completed, with the revision point expandable in place. Also the
  collapsible findings panel, remembered per browser.

## How a turn works

```
hold to speak ──► /api/transcribe ──► examinerTurn (server function) ──► /api/speak ──► <audio> plays
                  Deepgram nova-3     Claude Haiku 5.5 maps the words to          Deepgram aura-2,
                  + case keyterms     finding ids; code builds the reply          streamed MP3
                                      from the case JSON
```

The model **never sees finding values**. It only chooses ids from a list of id, eye and label. The reply
text is built by code from `data/case-EA-VIVA-001.json`, so it can't invent or change a value. If the
JSON changes, the app reflects the change with no prompt to update. Display text is the JSON verbatim. Spoken text puts
the eye first and expands only a fixed list: mmHg → "millimetres of mercury", mm → "millimetres",
6/36 Snellen → "six thirty-six Snellen" (in words: the voice read the digits "6 36" as "six three six"),
168/94 mmHg → "168 over 94", DS → "dioptres sphere", +3.50 → "plus 3.50", 1/4 → "a quarter". Units are
appended only to bare numbers, and tests check every bare measurement is spoken with its unit. This avoids the
data's traps: the pupil "5 mm" already has its unit, axial length has a unit but no value, and refraction is descriptive.

## Model choice and responsiveness

**Voice:** Deepgram `nova-3` (speech-to-text) and `aura-2` (text-to-speech). **Text:** Claude Haiku 5.5 (`claude-haiku-5-5`), effort `low`.

**Why.** The brief's hardest requirement is reading back the right eye, value and units. A cascaded pipeline
(speech-to-text → my code → text-to-speech) lets code decide the exact words spoken. Within that:
- **Speech-to-text accuracy on clinical words** is the biggest risk. Nova-3 supports
  [keyterm prompting](https://developers.deepgram.com/docs/keyterm). I pass terms built from the case's finding labels
  (gonioscopy, Van Herick, intraocular pressure…) plus drug names trainees say in answers. In a round trip
  (aura-2 speaking a request, nova-3 transcribing it), "gonioscopy" and "Van Herick" came back exactly.
- **Time to first audio.** Deepgram states ["Sub-200ms time-to-first-byte"](https://developers.deepgram.com/changelog/2025/5/14)
  for aura-2. The MP3 streams into an `<audio>` element, so playback starts before the clip is complete.
- **Haiku 5.5** only classifies a request (a few tokens of output) and writes two short texts. Any fast model
  would do. Haiku is the cheapest Claude model, and it doesn't handle audio, which this design doesn't need.

**Alternative considered: OpenAI `gpt-realtime-2.1-mini`** (speech-to-speech with tool calling over WebRTC).
It would probably cut latency, since a single model listens and speaks. But the model voices the tool result in its own words,
so "58 mmHg, right eye" can't be guaranteed word for word. It's also harder to time each stage.

**Measured voice turn.** The timer **starts when the trainee releases the talk button** (`performance.now()`
on pointer-up / Space key-up) and **stops when the examiner's audio fires `playing`**. That is the silence
the trainee actually waits through. It doesn't include the time spent speaking: releasing the button is
the trainee's "I've finished". Every voice turn saves its timing with the attempt, split into stages:

| Stage | How it's measured |
|---|---|
| Stop recording | Release → recording blob ready (browser) |
| Speech-to-text round trip | Upload + Deepgram + response (browser); Deepgram's own time from the `Server-Timing` header |
| Examiner round trip | Server function call, including Claude (browser) |
| Audio start | Audio requested → `playing` (browser); Deepgram's time to first byte from `Server-Timing` |

**Results** (Chrome on macOS, local dev server, 24 November 2026; turns that call the model):

| | First version (24 turns) | **After the fix (50 turns)** |
|---|---|---|
| **Voice turn, median** | 4.7s | **2.4s** |
| 90th percentile | 5.8s | 3.0s |
| Best / worst | 3.0s / 6.0s | 1.8s / 4.0s |
| Stop recording | 8ms | 7ms |
| Speech-to-text round trip | 0.75s | 0.73s |
| Examiner round trip (Haiku 5.5, effort low) | 1.09s | 1.16s |
| **Audio requested → playing** | **2.71s** | **0.40s** |
| of which Deepgram time to first byte | 0.28s | 0.28s |

**What the split showed.** In the first version, more than half the wait was the browser, not a model. Deepgram's
first audio arrived in about 0.28s, but a plain `<audio src>` buffered the streamed MP3 for about 2.4s more before it would play.
Feeding the chunks in myself through Media Source Extensions, so playback starts on the first chunk,
cut the median turn from 4.7s to 2.4s. The splitting also showed the examiner waiting for the Firestore save before speaking, so the two now run in parallel.
The largest stage left is the Haiku call (~1.2s), then transcription (~0.7s).
Next steps would be streaming speech-to-text while the trainee is still speaking (so the transcript is ready on release),
and a code fast path that skips the model when the request is an exact finding name.

Not done: checking the instrumented number against a screen recording's waveform, which would catch any
output delay after `playing` fires.

## Three repeatable checks

Full expected vs observed tables are in [CHECKS.md](CHECKS.md). Summary:

| Check | Input | Result |
|---|---|---|
| Available finding | "What's the pressure in the right eye?" | `iop_right`, "58 mmHg", right eye: pass |
| Unavailable finding | "Can I see the right angle on gonioscopy?" | Not available, "No view: corneal oedema", no value: pass |
| Citation supports the point | Answer that omits treating the fellow eye | Final run: retrieved pages 7, 7, 10, 4, 6; cited page 6 (`p6-8`), excerpt verbatim: pass |

## Handover

### Preparing the reference note

`npm run prepare:note` (`scripts/prepare-note.ts`) runs once and commits `data/note-chunks.json`:

1. **Extract** text with `pdfjs-dist`, keeping each item's position and font size.
2. **Strip** the running header (above y=800) and footer (below y=30, including the page number).
3. **Chunk by layout**, measured from the PDF: 15.5pt section headings, 11.5pt subheadings, 10.3pt body,
   and 8.6/9.2pt tables. A new chunk starts where the line gap widens (about 16pt within a paragraph, 19pt between
   bullets, 25pt between paragraphs). Table rows keep their column names
   ("Class: Systemic carbonic anhydrase inhibitors. Examples: Acetazolamide…"). Runs of very short bullets are combined.
   Each chunk carries its section path, e.g. "Managing an acute attack > Immediate treatment".
4. **Page spans.** A paragraph that runs over a page break (the acetazolamide bullet, pages 5–6) stays as one
   chunk, with character ranges per page. A citation uses the page where the quoted words are printed: "Check for
   sulfonamide allergy…" cites page 6, not "5–6". A quote that itself runs over the break cites both pages.
5. **Embed** each chunk (section heading + text) with a local model (`bge-small-en-v1.5` via transformers.js,
   so no API key is needed). Abbreviations the note defines on first use ("Laser peripheral iridotomy (LPI)") are
   expanded in the embedded text only. The stored text stays verbatim for checking quotes.

### Selecting relevant passages

1. **Find the gap.** Haiku compares the trainee's two answers with the case's key points and returns the most important
   miss, plus a search query for it. I search for the gap, not the trainee's own words, so the passage teaches
   something they missed rather than echoing what they said.
2. **Retrieve** with a hybrid: the top 3 chunks by embedding similarity plus the top 3 by BM25 keyword score,
   merged and ordered by reciprocal rank fusion (up to 6 passages).
3. **Write and verify.** Haiku must pick one retrieved passage and quote it word for word, or say none supports a point.
   Code finds the quote in that passage (ignoring only quote style, dashes, spacing and case) and shows the **note's own
   wording** for it, not the model's copy, with the page(s) it is printed on. A quote that can't be found, or is longer
   than 50 words, becomes "no support found".

Why hybrid: the note's distractor sections share vocabulary with the right answer. I checked five queries (one per
follow-up idea, plus the sulfonamide allergy and chlorphenamine key points) and looked at where the correct passage ranked:

| Retrieval | Rank of "Prophylactic LPI in the fellow eye" (p6) for a fellow-eye query |
|---|---|
| Embeddings only | 29th: general iridotomy pages (7, 10) won |
| + abbreviation expansion (LPI ↔ laser peripheral iridotomy) | 6th |
| + BM25 fused by RRF | 2nd, but the "If the IOP does not fall" passages dropped out for another query |
| **Union of top-3 embedding + top-3 BM25** (final) | Retrieved. All five queries retrieve their correct passage |

`npx tsx scripts/try-retrieval.ts "your query"` prints what retrieval returns.

### AI coding tools: one concrete example

I built this with Claude Code. **Example: passage retrieval for the revision point.** Claude Code wrote
the PDF chunker and the first retriever (embeddings only). It looked right, and the code was clean. I didn't
trust it until I'd measured it:

- **The chunker.** I printed every chunk alongside the PDF. One bug surfaced: a page 3 bullet ("…caused by corneal
  oedema") had been merged with an unrelated page 4 bullet ("Nausea, vomiting…"), because bullets often
  have no full stop. Fix: a paragraph only continues onto the next page if that page starts lowercase or with a digit.
  There's now a regression test (`src/note/chunk.test.ts`).
- **The retriever.** I wrote five queries with a known right answer (the three follow-up ideas plus two
  key points) and checked the rank of the passage that should win. The embeddings-only version ranked the key
  fellow-eye passage **29th**, behind the distractor pages. Each change after that was measured the same way
  (table above). One change fixed the fellow-eye query but broke another query, so it wasn't kept as it was.
- **The end-to-end check.** Check 3 (`npm run test:checks`) runs the whole revision step against the real
  model. It asserts that the right passage is retrieved, the cited passage is one that supports the point,
  the excerpt shown is the note's exact text, and the cited page is where that text is printed.

The lesson I took: the AI's first version was plausible and wrong on exactly the case the brief warns about
(distractors). The checks I wrote are what caught it, not reading the code.

## One improvement: hands-free turn-taking

**Sketch only, not built.** Trainees often practise while doing something else, such as at a slit lamp or in a
skills lab, where they can't reach a button or keyboard. Push-to-talk assumes a free hand. I prioritised this
because it's about how the product is actually used, and the core flow is already reliable.

**Design:**
- **Voice activity detection in the browser** (e.g. Silero VAD through `@ricky0123/vad-web`) replaces the hold
  button. Speech start → *Listening*. About 700ms of silence → end of turn, sent exactly like a button release.
- **Half-duplex.** The mic stays muted while the examiner is thinking or speaking, so it never transcribes its
  own voice. The four-state status indicator already models this.
- **Voice commands** for the stage buttons ("ready for my diagnosis", "repeat that"). The classifier already
  recognises the first.
- **Keep push-to-talk** as a toggle for noisy rooms.

**Risks to test:**
- Lab noise triggering false starts. Mitigate by requiring about 250ms of speech before a turn opens.
- Clinicians pausing mid-request ("the pressure in the… right eye") and being cut off. Tune the silence threshold, and
  accept a lower-confidence partial transcript, which the classifier tolerates well.
- Echo from laptop speakers. Rely on browser echo cancellation plus the muted mic.

**Measure it with** the same timer (end of speech → examiner audio). It should add the silence threshold
(about 0.7s) to each turn. That's the cost of going hands-free, and worth stating to users.
