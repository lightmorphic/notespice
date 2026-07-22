# Changelog

## Unreleased

- Added a caveat to the demo caption clarifying it's a demo of a few
  core features, not the complete app — things like search and
  import/export only exist in the real thing.
- Fixed a bug introduced by the previous change: the "+" button's
  click handler looked up its element by ID, but the element only had
  a class attribute, no ID. That threw at page-load time and silently
  killed the rest of the script — including the final call that
  populates the sidebar — so no sample notes rendered at all.
- Updated to match the real app's current state: stronger border/code
  contrast (matching the real app's fix for the same issue), delete
  now uses an inline two-step confirm button instead of a browser
  dialog, and the "+" button actually creates a new note now (opens
  it with the title focused and selected, matching the real app's
  reworked new-note flow) instead of doing nothing.
- Added a feature row for the zero-CDN-dependency editor rewrite.
- Fixed note title and content in the demo appearing center-justified
  (inherited from the hero section's centered layout) instead of
  left-justified, matching how markdown/notes actually render.
- Fixed the demo's Code and Checkbox-list toolbar buttons inserting
  visible placeholder text when nothing was selected, instead of
  leaving the cursor ready to type. Also fixed the footnote button
  using `innerHTML +=` to append its definition stub, which
  unnecessarily reparses the whole editor's content.
- Added a favicon (embedded, no extra file).
- Hero is now a single stacked column (text, then demo, then caption)
  instead of two-column, matching the requested layout.
- Demo card now has the full toolbar (heading levels, GitHub-style
  callouts, tables, footnotes, links/images/attachments) and a working
  Delete button with confirmation, ported directly from the real app —
  not a simplified stand-in.

## 1.0.0 — 2026-07-22

Initial release.

- One-page landing site: hero with a working embedded Writer/Markdown
  demo, "why" section, feature grid, Docker Compose get-started guide,
  footer links.
- Self-hosted Inter typeface and embedded logo — no external font or
  image requests at all.
- Monochrome window-control icons in the demo card (not macOS-style
  colored traffic lights).
