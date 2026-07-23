# Changelog

## 1.3.8 — 2026-07-23

- Matched the Writer editor's line spacing to Markdown mode's
  (line-height 1.6, was 2) so switching between the two views doesn't
  change the visible line gap.

## 1.3.7 — 2026-07-23

- Built and ran a comprehensive round-trip test suite covering every
  GFM feature this app supports (empty content, single lines, soft
  breaks, paragraph breaks, explicit `<br>` lines, all six heading
  levels, bold, italic, strikethrough, inline code, all combinations
  of inline formatting, links, images, unordered lists, ordered lists,
  nested lists, task lists, blockquotes, code blocks with and without
  language, tables, horizontal rules, GitHub-style callouts,
  footnotes, and every combination of these), plus an 11-scenario
  user-workflow test simulating the exact "build in Writer, switch
  to Markdown, switch back" sequence for each pattern. 68 scenarios
  total, all passing. Each verifies not just that the round trip is
  correct, but that repeating it is idempotent — switching modes back
  and forth does not drift.
- One real bug caught by that testing and fixed: the 3-or-more-Enter
  pattern (which serializes to a paragraph break plus an explicit
  `<br>` line) lost that extra `<br>` line when switching Markdown ->
  Writer -> Markdown a second time. Root cause: when a paragraph in
  the DOM started with a `<br>`, the serializer's leading-whitespace
  strip was erasing what should have been an explicit `<br>` line
  marker. Now counts and preserves leading `<br>`s per paragraph.

## 1.3.6 — 2026-07-23

- Fixed Enter at the end of an inline formatting element (bold,
  italic, code, etc.) producing broken markdown: the `<br>` was
  inserted *inside* the element, so the closing marker got orphaned
  onto its own line — `**a**` typed then Enter pressed at the end of
  `a` serialized as `**a\n**\nb` instead of `**a**\nb`. Now detects
  when the cursor is at the very end (or very start) of an inline
  element and inserts the `<br>` outside that element. Verified
  against the exact reported scenario; full existing test suite
  still passes.
- Increased the visible line spacing in the Writer editor by about
  50% (line-height 1.8 instead of the browser default ~1.2).

## 1.3.5 — 2026-07-23

- Finally fixed the disappearing-content bug after four rounds of
  wrong theories. The actual root cause, identified from a browser
  DevTools screenshot of the real DOM: when typing straight into the
  editor `<div>`, the content ended up as bare text nodes and `<br>`s
  as direct children of that div — no wrapping `<p>` at all. The
  markdown serializer's top-level walk had `if (node.nodeType !== 1)
  return`, so every bare text node ("a", "b", "c") at the top level
  was silently dropped, leaving nothing to serialize. That's the
  blank content. Fixed by gathering consecutive bare text and inline
  elements at the top level into an implicit paragraph, flushing it
  whenever a real block element is encountered. Verified against the
  exact DOM from the screenshot and against the full existing GFM
  test suite. Genuinely could not have found this without the DOM
  inspection — the previous four rounds were all reasoning about
  what the DOM *should* be, not what it actually was.

## 1.3.4 — 2026-07-23

- Fixed pasting multi-line text producing inconsistent, worsening
  corruption on each mode switch (extra blank lines that changed each
  time, and eventually lost content). Same root cause as the Enter-key
  bug fixed in the previous two entries: paste was still using
  `execCommand("insertText")` with a multi-line string, the same
  category of browser-dependent behavior that's unverifiable in this
  environment. Replaced with the same manual, tested Range-based
  insertion used for Enter — split the pasted text on newlines and
  insert a real `<br>` between each line directly, rather than
  delegating a multi-line string to execCommand and hoping for a
  predictable result.

## 1.3.3 — 2026-07-23

- Found the actual bug behind "needs a double Enter to reach the next
  line" — the previous entry's filler-character fix only checked
  whether the inserted `<br>` had *no* next sibling. Proved with a
  direct test that this check was wrong for the single most common
  case: pressing Enter with existing text before the cursor. Inserting
  a node into an existing text node splits it, leaving an *empty*
  text node as the `<br>`'s next sibling — not `null`, so the previous
  check incorrectly skipped the filler every time there was already
  text on the line, which is effectively always. An empty trailing
  text node contributes nothing visually, same as no sibling at all,
  so the browser still had nothing to render a line for. Now treats
  an empty text-node sibling the same as no sibling, and reuses it
  for the filler rather than creating a redundant extra node.

## 1.3.2 — 2026-07-23

- Found the actual root cause of the previous entry's data-loss bug
  still happening after that fix: a `<br>` with nothing after it (the
  normal case — pressing Enter at the end of what you're typing)
  doesn't render a visible new line by itself in most browsers, so the
  first Enter appeared to do nothing. The natural reaction — pressing
  Enter again — inserted a *second* real `<br>`, which the run-length
  logic correctly reads as a paragraph break rather than a second
  simple line break, producing structure the person never intended.
  Fixed by inserting a zero-width-space filler character (not a
  second real `<br>`) so the browser has something to render a line
  for, without it counting as an extra break when saved. Stripped
  before saving in the normal case where typing continues right after
  (verified: the filler gets naturally consumed), and explicitly
  stripped as a fallback if a person stops typing right after
  pressing Enter and the filler is still sitting there dangling.
- Honest limitation, given two rounds of this: I still don't have a
  real browser available to verify visual rendering directly — only
  the resulting DOM structure and serialization, which I can and do
  test rigorously (traced through the exact reported keystroke
  sequence step by step both times). If this still isn't right, the
  next useful thing to report is exactly what the DOM looks like via
  the browser inspector after the sequence that breaks, since that's
  the one thing I can't currently see for myself.

## 1.3.1 — 2026-07-23

- Fixed a serious data-loss bug: typing multiple lines in Writer mode
  (e.g. three lines separated by single Enter presses) could produce
  completely blank content when switching to Markdown mode, and stay
  blank switching back. Root cause: Enter was handled via
  `execCommand("insertLineBreak")`, whose exact resulting DOM
  structure is browser-dependent in ways this environment has no way
  to verify (no real browser available, and jsdom doesn't implement
  `execCommand` at all). Replaced with the same manual Range-based
  insertion already used and verified elsewhere in this file — traced
  through the exact type/Enter/type/Enter/type sequence step by step,
  confirmed it now produces a clean, predictable structure, and
  confirmed that structure serializes correctly rather than blank.
- Fixed soft breaks (a single Enter/Shift+Enter, or a bare newline in
  markdown typed directly) rendering as one run-on line instead of a
  visible line break — e.g. three lines typed directly in Markdown
  mode collapsed into one line in Writer mode. GitHub's own GFM
  renderer treats a soft break as an actual visible line break (a
  well-known deviation from strict CommonMark, where it's ambiguous
  and often collapses to a space); matched that with `white-space:
  pre-line` on paragraph content, rather than the browser's default
  whitespace-collapsing behavior.

## 1.3.0 — 2026-07-23

Security and code-quality audit.

- **XSS (fixed):** a note containing `[x](javascript:...)` — typed
  directly, or imported from a file — produced a real clickable link
  that executed arbitrary script in the logged-in session. Added a
  URL sanitizer (allow-list: `http(s)`, `mailto`, relative paths;
  everything else neutralized) and applied it everywhere a URL is
  inserted into `href`/`src`, both in the markdown parser and all four
  toolbar insertion paths. Verified against `javascript:`, `vbscript:`,
  and `data:` payloads.
- **Zip-bomb DoS (fixed):** import read each zip entry's decompressed
  content with no size limit at all — a few KB compressed could
  decompress to gigabytes. Added a 20MB per-entry cap and a 200MB
  cumulative cap across the whole archive. Verified against an actual
  25MB-decompressed/25KB-compressed test file: correctly rejected,
  nothing written to disk, server stayed healthy.
- **Writer is GFM-only, enforced, not just assumed:** paste is now
  forced to plain text only (rich HTML from Word/Google Docs/a webpage
  can carry both non-GFM formatting and markup that bypasses the
  parser's own URL sanitization), native drag-and-drop is blocked
  (same reasoning — use the Upload/Attach buttons instead), and Ctrl+U
  is blocked explicitly (browsers auto-wire this to underline for any
  `contenteditable`, with no code of ours calling for it).
- **Unbounded memory growth (fixed):** both the session map and the
  failed-login-attempts map in `auth.rs` only ever grew, cleaned up
  lazily only if the exact same key was looked up again. Since the
  rate-limit key is the raw client IP, and IPv6's address space makes
  generating huge numbers of distinct source addresses trivial, this
  was a real exhaustion vector. Fixed by sweeping expired entries on
  every new insert in both maps.
- **Search bug (found and fixed):** a note whose only distinctive word
  was in its *title*, not its body, was completely unfindable —
  the index only ever tokenized note content, and the separate
  title-match boost only re-ranks notes that already matched via
  content, it was never an independent source of matches. Now indexes
  title words too. Found by testing, not by reading the code.
- **Search optimization:** switched the index's outer map from
  `HashMap` to `BTreeMap`, so prefix matching (the common case —
  partial words like "fold" should match "folding") is now a real
  sorted-range query instead of a full linear scan over every unique
  token in the index on every search request.
- Removed a dead parameter (`title_lookup`) from `search()` that was
  always passed as `|_| true` and never actually invoked anywhere.
- Audited: path-traversal defenses in `store.rs` (titles and
  attachment filenames) tested directly against `../../`, absolute
  paths, and null-byte payloads sent through the real running API —
  all correctly contained. Confirmed attachment downloads require
  auth. Confirmed the global 25MB request body limit is actually
  enforced (413, server stays healthy). All 120 dependencies in
  `Cargo.lock` checked against the current RustSec advisory database
  with precise semver comparison — zero actionable vulnerabilities.
  Every `.unwrap()`/`.expect()` in the Rust source reviewed — none
  reachable from untrusted input in a way that could panic.

## 1.2.0 — 2026-07-23

- Enter and Shift+Enter now behave identically, and what they produce
  depends on how many land in a row rather than which key was used:
  one is a plain soft break (no gap), two is a real paragraph break
  (blank line), and three or more adds an explicit `<br>` line on top
  of the paragraph break — since GFM collapses any number of blank
  lines to a single paragraph break, an actual line-break tag is the
  only way to force extra space beyond that. Verified all three cases
  produce exactly this, that a saved `<br>` line reopens as a real
  line break rather than literal text, and that the existing GFM
  suite and prior fixes still pass.
- One honest caveat: reopening a note that has the three-or-more-break
  pattern and resaving it *without further edits* collapses it back to
  a plain paragraph break, since reopening only recreates one real
  `<br>` element rather than the original three. The markdown stays
  valid either way; it just loses the extra spacing if resaved
  untouched immediately after reopening.

## 1.1.3 — 2026-07-23

- Fixed Shift+Enter producing markdown that isn't valid GFM: a bare
  single newline is only a "soft break" in the spec, which most
  renderers collapse to a space rather than an actual line break —
  and the parser didn't even round-trip it correctly, reading it back
  as two separate paragraphs, identical to a blank line. A real GFM
  hard break requires two trailing spaces before the newline (or a
  trailing backslash). Fixed both directions: `<br>` now serializes
  to that exact syntax, and the parser properly consumes multi-line
  paragraphs, distinguishing an explicit hard break from a plain soft
  break rather than treating every line as its own paragraph. Verified
  the full round trip is now exact for both break types, and confirmed
  the existing GFM feature suite and the earlier nested-content fix
  still pass.

## 1.1.2 — 2026-07-22

- Fixed a real data-loss bug in the Writer editor: typing multiple
  lines and switching to Markdown mode could silently lose earlier
  lines entirely. Root cause: browsers are inconsistent about what
  element Enter produces in a `contenteditable` (Chrome defaults to
  `<div>`, and the exact nesting can vary by cursor position), and the
  markdown converter walked the DOM expecting clean sibling elements.
  Fixed two ways: explicitly setting the default paragraph separator
  so Enter reliably produces a real paragraph, and making the
  converter itself defensive against unexpected nesting (verified with
  several simulated bad-nesting cases, including one that reproduced
  the exact symptom, before and after the fix). Also confirms the
  Enter-vs-Shift+Enter distinction (blank line vs. no gap) was already
  correct, expected behavior once nesting is handled properly, not a
  separate bug.

## 1.1.1 — 2026-07-22

- Fixed undo/redo, the Writer/Markdown toggle, and delete being
  unreachable on narrow/mobile screens — the toolbar is one row that
  doesn't fit that content plus the title on screens this width, so
  those controls were getting squeezed off rather than actually
  disappearing. Now wraps into two rows on narrow screens, with that
  action group on its own row above the title.

## 1.1.0 — 2026-07-22

- Fixed the sidebar not actually reflecting recently-viewed order:
  the server was always recording views and reordering correctly, but
  the frontend re-rendered the list from a stale array after opening
  a note instead of re-fetching, so the reorder never showed up until
  something else happened to trigger a full reload.
- Added a pin button (top-right of the sidebar) that keeps the
  sidebar open regardless of clicking the editor, typing, or
  selecting a note — previously it always auto-collapsed on any of
  those.
- "New note" no longer prompts for a title in a dialog — it creates
  an "Untitled" note immediately (deduping against existing titles)
  and opens it with the title field focused and selected, so you
  rename it in place instead.
- Delete no longer uses a browser `confirm()` dialog — clicking it
  turns the button into an inline red "Confirm" button (matching the
  pattern used in chkt) that reverts after 4 seconds or a click
  elsewhere if you don't follow through.

## 1.0.0 — 2026-07-22

Initial release.

- Notes stored as plain `.md` files, filename = title — no database.
  Attachments (images, uploads, generic files) stored alongside them
  under `files/`, referenced by ordinary markdown links.
- Storage split into two directories: `NOTES_DIR` for notes and
  attachments (the actual vault), `NOTES_DATA_DIR` for app-only state
  (currently just the recently-viewed list) — kept separate so nothing
  that isn't your data ever lives inside your vault.
- Full GitHub Flavored Markdown toolbar: headings, bold/italic/
  strikethrough/inline code, all three list types with indent/outdent,
  blockquotes, fenced code blocks, tables, horizontal rules, footnotes,
  and GitHub-style callouts (`> [!NOTE]` etc.) — rendered with the same
  colored-box treatment GitHub.com uses.
- WYSIWYG editor with a one-click Writer/Markdown toggle and undo/redo.
  A small hand-written markdown ⇄ HTML converter, not a third-party
  editor library loaded from a CDN — nothing external to
  version-mismatch or break.
- In-memory inverted-index full-text search, rebuilt from disk at
  startup.
- Sidebar shows the last 10 *viewed* notes first (most-recent-open at
  top, not last-edited), falling back to last-modified order for
  everything else. Collapsible/overlay sidebar on narrow screens, with
  instant name-filtering and full-content search on Enter.
- Export to a dated zip; import that same zip (or a loose `.md` file)
  back in, deduplicating on title collision rather than overwriting.
- Installable PWA — manifest, icons, and a service worker that caches
  only the static shell, never note content.
- Single username/password auth: Argon2id hashing, server-side session
  tokens, per-IP login rate limiting.
- Self-hosted Inter typeface — no Google Fonts CDN, no external font
  request of any kind.
- Multi-stage Dockerfile (non-root user, OS packages patched at build
  time, healthcheck), docker-compose example, and a GitHub Actions
  workflow publishing to GHCR with a weekly rebuild for security
  patches.
