## Code quality

Adapted from Clean Code (Robert C. Martin), filtered for this codebase.
Code is read far more often than it's written — optimise for the reader.

### Naming

- Names carry intent.
- No abbreviations, no type-encoding.
- Longer name > shorter name + comment.

### Functions

- Do one thing, at one level of abstraction.
- Prefer 0–2 arguments. No boolean flag arguments — split the function.
- No hidden side effects: the name promises everything the function does.
- Command/query separation: a function either changes state or answers a
  question, never both.

### Self-documenting code — comments are a last resort

Default is zero. Self-documenting code says what it does. A comment describing
_what_ the code does is a rename or an extraction that didn't happen.

Comments rot. Nothing compiles them, nothing tests them, so they drift from the
code they describe and end up lying. Code is the only description guaranteed to
be true.

Ladder — stop at the first rung that holds:

1. **Rename** — a clearer variable or function name removes most comments
   outright.
2. **Extract a named local** — `const isEligible = age >= 18 && !suspended`
   replaces `// check they're eligible`.
3. **Extract a function** — when a block needs a heading, the heading is a
   function name. A comment above a block is usually a function waiting to be
   named.
4. **Only if all three fail, write the comment.**

Survival test, applied to every comment one at a time: delete it. If nothing is
lost that the code beside it can't tell you, it stays deleted. Only three kinds
normally survive:

- **Why** — the non-obvious reason, the rejected alternative, the bug this
  guards against, the vendor quirk being worked around. Intent can't always
  be expressed in code; that's the legitimate case.
- **Warnings of consequence** — "takes 40s, don't call it in a request". Use `@WARNING:`.
- Deliberate shortcuts, naming the ceiling and the upgrade path.

Delete on sight, in your own diff and in any code you touch:

- Restating the code (`// increment i`), JSDoc that repeats the signature,
  policy-mandated boilerplate.
- Commented-out code — git remembers it.
- Journals, bylines, changelogs, `// ===== section =====` banners,
  closing-brace labels.
- Any comment that no longer matches the code beside it. A stale comment is
  worse than none: it actively lies.

Before calling the work done, read every comment in the diff and run the
survival test on each. Most fail. Deleting them is the last edit.

### Duplication

- The primary smell. Extract on the second occurrence, not the first —
  speculative abstraction is its own cost.

### Error handling

- Throw; don't return error codes.
- Don't leak provider-specific errors upward past a boundary.

### Boundaries

- Wrap third-party APIs behind our own thin interface so vendor churn stays
  contained at one seam.

### Tests

- Test code is held to the same standard as production code.
- Fast, independent, repeatable, self-validating.
- One concept asserted per test.

### Continuous cleanup

- Boy Scout rule: leave touched code slightly cleaner than you found it.
