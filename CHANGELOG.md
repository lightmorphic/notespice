# Changelog

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
