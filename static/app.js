if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal: the app works fine without a service worker, it
      // just won't be installable as a PWA or cache its shell.
    });
  });
}

// ---------- tiny state ----------
let currentTitle = null;      // title of the note currently open, or null
let originalTitle = null;     // title as last saved, to detect renames
let mode = "wysiwyg";         // "wysiwyg" | "raw"
let saveTimer = null;
let allNotes = [];            // last full note list, for restoring after a cleared search

const el = (id) => document.getElementById(id);

// Without this, browsers are inconsistent about what Enter produces
// in a contenteditable (Chrome defaults to <div>, and the exact
// nesting can vary by cursor position) — forcing a real <p> per Enter
// keeps the DOM shape predictable and matching what htmlToMd expects.
document.execCommand("defaultParagraphSeparator", false, "p");

// ---------- API helpers ----------
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error("not logged in");
  }
  return res;
}

async function apiJson(path, options = {}) {
  const res = await api(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || "request failed");
  }
  return res.json();
}

// ---------- screens ----------
function showLogin() {
  el("login-screen").hidden = false;
  el("app-screen").hidden = true;
}

function showApp() {
  el("login-screen").hidden = true;
  el("app-screen").hidden = false;
}

// ---------- login ----------
el("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = el("login-username").value;
  const password = el("login-password").value;
  const errorEl = el("login-error");
  errorEl.hidden = true;

  let res;
  try {
    res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch (err) {
    console.error("Login request failed:", err);
    errorEl.textContent = "could not reach the server";
    errorEl.hidden = false;
    return;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "login failed" }));
    errorEl.textContent = body.error || "login failed";
    errorEl.hidden = false;
    return;
  }

  showApp();
  try {
    await loadNotes();
  } catch (err) {
    console.error("Failed to load notes after login:", err);
    alert("Logged in, but failed to load your notes: " + err.message + "\n\nCheck the browser console for details.");
  }
});

el("logout-btn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  currentTitle = null;
  showLogin();
});

// ---------- export / import ----------
el("export-btn").addEventListener("click", () => {
  window.location.href = "/api/export";
});

el("import-btn").addEventListener("click", () => el("import-file-input").click());

el("import-file-input").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;

  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch("/api/import", { method: "POST", body: form });
    if (res.status === 401) {
      showLogin();
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "import failed" }));
      alert(body.error || "import failed");
      return;
    }
    const { imported_notes, imported_files } = await res.json();
    alert(`Imported ${imported_notes} note${imported_notes === 1 ? "" : "s"}` +
      (imported_files ? ` and ${imported_files} file${imported_files === 1 ? "" : "s"}` : "") + ".");
    await loadNotes();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- collapsible sidebar ----------
let sidebarPinned = true;

function isNarrow() {
  return window.innerWidth <= 700;
}
function setSidebarOpen(open) {
  document.querySelector(".sidebar").classList.toggle("collapsed", !open);
  el("sidebar-backdrop").classList.toggle("visible", open);
}
el("sidebar-backdrop").addEventListener("click", () => setSidebarOpen(false));
el("menu-toggle-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const sidebar = document.querySelector(".sidebar");
  setSidebarOpen(sidebar.classList.contains("collapsed"));
});
el("pin-btn").addEventListener("click", () => {
  sidebarPinned = !sidebarPinned;
  el("pin-btn").classList.toggle("active", sidebarPinned);
  el("pin-btn").setAttribute("aria-pressed", String(sidebarPinned));
  if (sidebarPinned) setSidebarOpen(true);
});
// Clicking anywhere in the right-hand pane (not just typing) also
// gets the sidebar out of the way — unless pinned, in which case it
// stays open regardless.
document.querySelector(".editor-pane").addEventListener("click", () => {
  if (!sidebarPinned) setSidebarOpen(false);
});
setSidebarOpen(!isNarrow());

// ---------- note list ----------
async function loadNotes() {
  allNotes = await apiJson("/notes");
  renderNoteList(allNotes);
  if (!currentTitle && allNotes.length) {
    await openNote(allNotes[0].title);
  } else if (!allNotes.length) {
    el("empty-state").hidden = false;
  }
}

function renderNoteList(notes) {
  const list = el("note-list");
  list.innerHTML = "";
  for (const note of notes) {
    const li = document.createElement("li");
    li.textContent = note.title;
    li.dataset.title = note.title;
    if (note.title === currentTitle) li.classList.add("active");
    li.addEventListener("click", () => {
      openNote(note.title);
      if (isNarrow() && !sidebarPinned) setSidebarOpen(false);
    });
    list.appendChild(li);
  }
}

function closeSearchResults() {
  const results = el("search-results");
  if (results.hidden) return;
  results.hidden = true;
  if (currentTitle) el("editor").hidden = false;
  else el("empty-state").hidden = false;
}

async function showSearchResults(query) {
  query = query.trim();
  if (!query) return;
  const matches = await apiJson(`/search?q=${encodeURIComponent(query)}`);

  el("empty-state").hidden = true;
  el("editor").hidden = true;
  const results = el("search-results");
  results.hidden = false;
  results.innerHTML = `<div class="results-heading">${matches.length} result${matches.length === 1 ? "" : "s"} for "${query.replace(/</g, "&lt;")}"</div>`;
  for (const { title } of matches) {
    const item = document.createElement("div");
    item.className = "result-item";
    const titleDiv = document.createElement("div");
    titleDiv.className = "result-title";
    titleDiv.textContent = title;
    item.appendChild(titleDiv);
    item.addEventListener("click", () => {
      results.hidden = true;
      openNote(title);
      if (isNarrow() && !sidebarPinned) setSidebarOpen(false);
    });
    results.appendChild(item);
  }
}

let searchDebounce = null;
el("search-box").addEventListener("input", (e) => {
  closeSearchResults();
  clearTimeout(searchDebounce);
  const q = e.target.value.trim().toLowerCase();
  searchDebounce = setTimeout(() => {
    renderNoteList(q ? allNotes.filter((n) => n.title.toLowerCase().includes(q)) : allNotes);
  }, 100);
});

el("search-box").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    showSearchResults(e.target.value);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== el("search-box") && !el("app-screen").hidden) {
    e.preventDefault();
    el("search-box").focus();
  }
});

// ---------- markdown <-> HTML conversion ----------
// Notespice's own converter — no external editor library, no CDN
// dependency. Supports the full GFM feature set this app's toolbar
// exposes: headings 1-6, bold/italic/strikethrough/inline code, all
// three list types with nesting, blockquotes, fenced code blocks,
// tables, footnotes, GitHub-style callouts, links, and images.
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Only allow schemes that can't execute code when clicked/loaded:
// http(s), mailto, and schemeless (relative paths, #anchors — covers
// our own /api/files/... upload URLs). Anything else (javascript:,
// vbscript:, data:, etc.) is neutralized to "#" rather than inserted
// as-is — a note containing `[x](javascript:...)`, typed directly or
// imported from a file, would otherwise execute arbitrary script in
// the logged-in session when clicked.
function sanitizeUrl(url) {
  const trimmed = (url || "").trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return "#";
}

function inlineMdToHtml(text) {
  let html = escapeHtml(text);
  const codes = [];
  html = html.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return "\u0000C" + (codes.length - 1) + "\u0000";
  });
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => '<img src="' + sanitizeUrl(url) + '" alt="' + alt + '">');
  html = html.replace(/\[\^([^\]]+)\]/g, '<sup class="footnote-ref" data-fn="$1">$1</sup>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => '<a href="' + sanitizeUrl(url) + '">' + label + "</a>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\u0000C(\d+)\u0000/g, (_, i) => "<code>" + codes[+i] + "</code>");
  return html;
}

function inlineNodeToMd(node) {
  let out = "";
  const children = Array.from(node.childNodes);
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (child.nodeType === 1 && child.tagName.toLowerCase() === "br") {
      let runLength = 0;
      let j = i;
      while (j < children.length && children[j].nodeType === 1 && children[j].tagName.toLowerCase() === "br") {
        runLength++;
        j++;
      }
      if (runLength === 1) out += "\n";
      else if (runLength === 2) out += "\n\n";
      else out += "\n\n" + "<br>\n".repeat(runLength - 2);
      i = j;
      continue;
    }
    if (child.nodeType === 3) { out += child.textContent; i++; continue; }
    if (child.nodeType !== 1) { i++; continue; }
    const tag = child.tagName.toLowerCase();
    if (tag === "input" && child.type === "checkbox") { i++; continue; }
    const inner = inlineNodeToMd(child);
    if (tag === "strong" || tag === "b") out += "**" + inner + "**";
    else if (tag === "em" || tag === "i") out += "*" + inner + "*";
    else if (tag === "del" || tag === "s" || tag === "strike") out += "~~" + inner + "~~";
    else if (tag === "code") out += "`" + inner + "`";
    else if (tag === "a") out += "[" + inner + "](" + child.getAttribute("href") + ")";
    else if (tag === "img") out += "![" + (child.getAttribute("alt") || "") + "](" + child.getAttribute("src") + ")";
    else if (tag === "sup" && child.classList.contains("footnote-ref")) out += "[^" + child.getAttribute("data-fn") + "]";
    else if (tag === "ul" || tag === "ol") { /* handled separately by caller */ }
    else out += inner;
    i++;
  }
  return out;
}

function inlineOnly(node) {
  const clone = node.cloneNode(true);
  clone.querySelectorAll("ul, ol").forEach((n) => n.remove());
  const cb = clone.querySelector('input[type="checkbox"]');
  if (cb) cb.remove();
  return inlineNodeToMd(clone).replace(/^\s+/, "");
}

const HEADING_PATTERNS = [
  [/^######\s+/, "h6"], [/^#####\s+/, "h5"], [/^####\s+/, "h4"],
  [/^###\s+/, "h3"], [/^##\s+/, "h2"], [/^#\s+/, "h1"],
];

// Used to know when to stop consuming lines into the current
// paragraph — a paragraph continues across lines until a blank line
// *or* a line that starts a different kind of block.
function isBlockStart(line) {
  if (/^```/.test(line)) return true;
  if (/^\|.*\|\s*$/.test(line)) return true;
  if (HEADING_PATTERNS.some((p) => p[0].test(line))) return true;
  if (/^\[\^([^\]]+)\]:\s*/.test(line)) return true;
  if (/^>\s?/.test(line)) return true;
  if (/^(---|\*\*\*)\s*$/.test(line)) return true;
  if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) return true;
  return false;
}

let footnoteDefs;
function mdToHtmlInner(md) {
  const lines = md.split("\n");
  let html = "";
  let i = 0;
  const stack = [];

  function closeListsTo(indent) {
    while (stack.length && stack[stack.length - 1].indent >= indent) {
      const frame = stack.pop();
      if (frame.liOpen) html += "</li>";
      html += "</" + frame.type + ">";
      // Closing a nested list also closes the parent item it was
      // nested inside (the <li> stays open across a sublist so the
      // sublist ends up a *child* of that <li>, not a sibling of it).
      if (stack.length && stack[stack.length - 1].liOpen) {
        html += "</li>";
        stack[stack.length - 1].liOpen = false;
      }
    }
  }
  function closeAllLists() { closeListsTo(-1); }

  while (i < lines.length) {
    const raw = lines[i];

    if (/^```/.test(raw)) {
      closeAllLists();
      const lang = raw.replace(/^```/, "").trim();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
      html += '<pre' + (lang ? ' data-lang="' + escapeHtml(lang) + '"' : "") + '><code>' + escapeHtml(code.join("\n")) + "</code></pre>";
      i++;
      continue;
    }

    if (/^\|.*\|\s*$/.test(raw) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      closeAllLists();
      const headerCells = raw.replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      html += "<table><thead><tr>" + headerCells.map((c) => "<th>" + inlineMdToHtml(c) + "</th>").join("") + "</tr></thead><tbody>";
      rows.forEach((r) => {
        html += "<tr>" + r.map((c) => "<td>" + inlineMdToHtml(c) + "</td>").join("") + "</tr>";
      });
      html += "</tbody></table>";
      continue;
    }

    const headingHit = HEADING_PATTERNS.find((p) => p[0].test(raw));
    if (headingHit) {
      closeAllLists();
      html += "<" + headingHit[1] + ">" + inlineMdToHtml(raw.replace(headingHit[0], "")) + "</" + headingHit[1] + ">";
      i++;
      continue;
    }

    const fnDefMatch = raw.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (fnDefMatch) {
      closeAllLists();
      footnoteDefs.push({ id: fnDefMatch[1], html: inlineMdToHtml(fnDefMatch[2]) });
      i++;
      continue;
    }

    if (/^>\s?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(raw)) {
      closeAllLists();
      const alertType = raw.match(/\[!(\w+)\]/i)[1].toUpperCase();
      const firstLine = raw.replace(/^>\s?\[!\w+\]\s*/i, "");
      const body = [firstLine];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i])) { body.push(lines[i].replace(/^>\s?/, "")); i++; }
      const bodyText = body.join(" ").trim();
      html += '<div class="md-alert md-alert-' + alertType.toLowerCase() + '"><p class="md-alert-title">' + alertType.charAt(0) + alertType.slice(1).toLowerCase() + "</p>" +
        (bodyText ? "<p>" + inlineMdToHtml(bodyText) + "</p>" : "") + "</div>";
      continue;
    }

    if (/^>\s?/.test(raw)) {
      closeAllLists();
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, "")); i++; }
      html += "<blockquote><p>" + inlineMdToHtml(quote.join(" ")) + "</p></blockquote>";
      continue;
    }

    if (/^(---|\*\*\*)\s*$/.test(raw)) { closeAllLists(); html += "<hr>"; i++; continue; }

    const listMatch = raw.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const indent = listMatch[1].length;
      const marker = listMatch[2];
      const content = listMatch[3];
      const type = /\d+\./.test(marker) ? "ol" : "ul";
      const checkMatch = content.match(/^\[( |x|X)\]\s+(.*)$/);
      const isCheck = !!checkMatch;

      closeListsTo(indent + 1);
      if (!stack.length || stack[stack.length - 1].indent < indent) {
        stack.push({ indent, type, liOpen: false });
        html += "<" + type + (isCheck ? ' class="task-list"' : "") + ">";
      } else if (stack[stack.length - 1].indent === indent && stack[stack.length - 1].type !== type) {
        const old = stack.pop();
        if (old.liOpen) html += "</li>";
        html += "</" + old.type + ">";
        stack.push({ indent, type, liOpen: false });
        html += "<" + type + (isCheck ? ' class="task-list"' : "") + ">";
      }

      const top = stack[stack.length - 1];
      if (top.liOpen) html += "</li>";
      if (isCheck) {
        const checked = /x/i.test(checkMatch[1]);
        html += "<li><label><input type=\"checkbox\"" + (checked ? " checked" : "") + "> " + inlineMdToHtml(checkMatch[2]) + "</label>";
      } else {
        html += "<li>" + inlineMdToHtml(content);
      }
      top.liOpen = true;
      i++;
      continue;
    }

    if (raw.trim() === "") { closeAllLists(); i++; continue; }

    closeAllLists();
    const paraLines = [raw];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    let paraHtml = "";
    paraLines.forEach((line, idx) => {
      const isLast = idx === paraLines.length - 1;
      const trimmed = line.trim();
      if (/^<br\s*\/?>$/i.test(trimmed)) {
        paraHtml += "<br>";
        return;
      }
      const hardBreak = !isLast && /(  +|\\)$/.test(line);
      const cleanLine = line.replace(/(  +|\\)$/, "");
      paraHtml += inlineMdToHtml(cleanLine);
      if (!isLast) paraHtml += hardBreak ? "<br>" : "\n";
    });
    html += "<p>" + paraHtml + "</p>";
  }
  closeAllLists();

  if (footnoteDefs.length) {
    html += '<div class="footnotes"><hr><ol>';
    footnoteDefs.forEach((fn) => {
      html += '<li id="fn-' + escapeHtml(fn.id) + '">' + fn.html + "</li>";
    });
    html += "</ol></div>";
  }

  return html || "<p></p>";
}

function mdToHtml(md) {
  footnoteDefs = [];
  return mdToHtmlInner(md);
}

function serializeList(listEl, depth) {
  const lines = [];
  const isOl = listEl.tagName.toLowerCase() === "ol";
  let n = 1;
  listEl.querySelectorAll(":scope > li").forEach((li) => {
    const indent = "  ".repeat(depth);
    const cb = li.querySelector(':scope > label > input[type="checkbox"], :scope > input[type="checkbox"]');
    const text = inlineOnly(li);
    if (cb) {
      lines.push(indent + "- [" + (cb.checked ? "x" : " ") + "] " + text);
    } else if (isOl) {
      lines.push(indent + (n++) + ". " + text);
    } else {
      lines.push(indent + "- " + text);
    }
    const nested = li.querySelector(":scope > ul, :scope > ol");
    if (nested) lines.push(serializeList(nested, depth + 1));
  });
  return lines.join("\n");
}

function htmlToMd(container) {
  const out = [];
  container.childNodes.forEach((node) => {
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) out.push("#".repeat(+tag[1]) + " " + inlineOnly(node));
    else if (tag === "blockquote") out.push("> " + node.textContent);
    else if (tag === "div" && node.classList.contains("md-alert")) {
      const type = Array.from(node.classList).find((c) => c.indexOf("md-alert-") === 0).replace("md-alert-", "").toUpperCase();
      const bodyP = node.querySelector("p:not(.md-alert-title)");
      const bodyText = bodyP ? inlineOnly(bodyP) : "";
      out.push("> [!" + type + "]" + (bodyText ? "\n> " + bodyText : ""));
    } else if (tag === "div" && node.classList.contains("footnotes")) {
      const lines = [];
      node.querySelectorAll("li").forEach((li) => {
        const id = li.id.replace(/^fn-/, "");
        lines.push("[^" + id + "]: " + inlineOnly(li));
      });
      out.push(lines.join("\n\n"));
    } else if (tag === "hr") out.push("---");
    else if (tag === "pre") {
      const lang = node.getAttribute("data-lang") || "";
      out.push("```" + lang + "\n" + node.textContent + "\n```");
    } else if (tag === "ul" || tag === "ol") {
      out.push(serializeList(node, 0));
    } else if (tag === "table") {
      const headerCells = [];
      node.querySelectorAll("thead th").forEach((th) => headerCells.push(inlineOnly(th)));
      const rows = [];
      node.querySelectorAll("tbody tr").forEach((tr) => {
        const cells = [];
        tr.querySelectorAll("td").forEach((td) => cells.push(inlineOnly(td)));
        rows.push(cells);
      });
      const tlines = [];
      tlines.push("| " + headerCells.join(" | ") + " |");
      tlines.push("| " + headerCells.map(() => "---").join(" | ") + " |");
      rows.forEach((r) => tlines.push("| " + r.join(" | ") + " |"));
      out.push(tlines.join("\n"));
    } else if (tag === "p" || tag === "div") {
      if (node.querySelector("p, div, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, hr")) {
        // Unexpected nested block content mixed with loose text —
        // walk this node's own children directly so any loose text
        // sitting alongside a nested block isn't silently dropped
        // (recursing wholesale would skip it, since htmlToMd only
        // processes element children, not bare text nodes).
        const parts = [];
        let looseBuffer = document.createElement("div");
        const flushLoose = () => {
          if (looseBuffer.childNodes.length) {
            const text = inlineOnly(looseBuffer);
            if (text) parts.push(text);
            looseBuffer = document.createElement("div");
          }
        };
        node.childNodes.forEach((child) => {
          if (child.nodeType === 1 && /^(p|div|h[1-6]|ul|ol|blockquote|pre|table|hr)$/.test(child.tagName.toLowerCase())) {
            flushLoose();
            const wrapper = document.createElement("div");
            wrapper.appendChild(child.cloneNode(true));
            const nested = htmlToMd(wrapper);
            if (nested) parts.push(nested);
          } else {
            looseBuffer.appendChild(child.cloneNode(true));
          }
        });
        flushLoose();
        if (parts.length) out.push(parts.join("\n\n"));
      } else {
        out.push(inlineOnly(node));
      }
    }
  });
  return out.join("\n\n");
}

// ---------- editor ----------
el("new-note-btn").addEventListener("click", async () => {
  let title = "Untitled";
  let n = 1;
  // Dedupe against existing titles rather than relying on the
  // server's own collision handling, which is built for import (a
  // "(1)", "(2)" suffix), not for finding the next free "Untitled N".
  const existingTitles = new Set(allNotes.map((note) => note.title));
  while (existingTitles.has(title)) {
    n++;
    title = "Untitled " + n;
  }
  try {
    await apiJson("/notes", {
      method: "POST",
      body: JSON.stringify({ title, content: "" }),
    });
    await loadNotes();
    await openNote(title);
    if (isNarrow()) setSidebarOpen(false);
    el("title-input").focus();
    el("title-input").select();
  } catch (e) {
    alert(e.message);
  }
});

async function openNote(title) {
  const note = await apiJson(`/notes/${encodeURIComponent(title)}`);
  currentTitle = note.title;
  originalTitle = note.title;

  el("search-results").hidden = true;
  el("empty-state").hidden = true;
  el("editor").hidden = false;
  el("title-input").value = note.title;
  el("raw-textarea").value = note.content;
  el("wysiwyg-editor").innerHTML = mdToHtml(note.content);
  resetDeleteButton();

  // Opening a note just moved it to the front of the server's
  // recently-viewed order — re-fetch so the sidebar reflects that
  // immediately, rather than re-rendering the array from before this
  // note was opened (which is why the list previously looked like it
  // wasn't actually tracking what was last viewed).
  allNotes = await apiJson("/notes");
  renderNoteList(allNotes);
}

async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/files", { method: "POST", body: form });
  if (res.status === 401) {
    showLogin();
    throw new Error("not logged in");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "upload failed" }));
    throw new Error(body.error || "upload failed");
  }
  return res.json(); // { filename, url }
}

function currentMarkdown() {
  if (mode === "wysiwyg") return htmlToMd(el("wysiwyg-editor"));
  return el("raw-textarea").value;
}

function nextFootnoteNumber() {
  const md = currentMarkdown();
  let max = 0;
  const re = /\[\^(\d+)\]/g;
  let m;
  while ((m = re.exec(md))) max = Math.max(max, parseInt(m[1], 10));
  return max + 1;
}

// Wraps the current selection in `tagName`. If nothing is selected,
// inserts an empty element (a zero-width space, invisible) with the
// cursor placed inside it, so typing continues in that format —
// rather than inserting visible placeholder text the person then has
// to notice, select, and delete. Verified structurally with jsdom
// (both the collapsed- and selected-text paths) before shipping.
function wrapSelectionInline(tagName) {
  const s = window.getSelection();
  if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  const elNode = document.createElement(tagName);
  if (r.collapsed) {
    elNode.appendChild(document.createTextNode("\u200B"));
    r.insertNode(elNode);
    const nr = document.createRange();
    nr.setStart(elNode.firstChild, 1);
    nr.collapse(true);
    s.removeAllRanges();
    s.addRange(nr);
  } else {
    const contents = r.extractContents();
    elNode.appendChild(contents);
    r.insertNode(elNode);
    const nr2 = document.createRange();
    nr2.setStartAfter(elNode);
    nr2.collapse(true);
    s.removeAllRanges();
    s.addRange(nr2);
  }
}

// Same idea for a checklist item: no placeholder "task" text, cursor
// lands inside the label ready to type.
function insertChecklistItem(labelText) {
  const s = window.getSelection();
  if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  const ul = document.createElement("ul");
  ul.className = "task-list";
  const li = document.createElement("li");
  const label = document.createElement("label");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  label.appendChild(cb);
  const textNode = document.createTextNode(" " + (labelText || ""));
  label.appendChild(textNode);
  li.appendChild(label);
  ul.appendChild(li);
  r.deleteContents();
  r.insertNode(ul);
  const nr = document.createRange();
  nr.setStart(textNode, textNode.textContent.length);
  nr.collapse(true);
  s.removeAllRanges();
  s.addRange(nr);
}

function onEditingInput() {
  if (!sidebarPinned) setSidebarOpen(false);
  scheduleSave();
}
el("raw-textarea").addEventListener("input", onEditingInput);
el("title-input").addEventListener("input", onEditingInput);
el("wysiwyg-editor").addEventListener("input", onEditingInput);
// Enter and Shift+Enter both just insert a line break — never a
// native paragraph split. What that break *means* in the saved
// markdown depends on how many land in a row (handled by
// inlineNodeToMd's run-length logic): one is a soft break, two is a
// real paragraph break, three or more adds explicit <br> lines, since
// GFM collapses any number of blank lines to a single paragraph break
// and extra ones add no visual gap on their own.
el("wysiwyg-editor").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    // Manual Range-based insertion, not execCommand("insertLineBreak")
    // — execCommand's exact DOM behavior varies by browser in ways
    // this environment has no way to verify (no real browser, and
    // jsdom doesn't implement execCommand at all), and it's the most
    // likely cause of a real data-loss bug: an unpredictable resulting
    // structure the markdown parser doesn't walk correctly. This
    // mirrors wrapSelectionInline's approach below, which is directly
    // testable and already verified.
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const br = document.createElement("br");
      range.insertNode(br);
      range.setStartAfter(br);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  // Browsers auto-wire Ctrl+U to underline for any contenteditable,
  // with no code of ours calling for it — underline has no GFM
  // representation, so block it explicitly rather than relying only
  // on the serializer's fallback to silently drop it on save.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u") {
    e.preventDefault();
  }
});
// Force paste to plain text only. Rich HTML from Word/Google Docs/a
// webpage can carry formatting with zero GFM representation (colors,
// underline, fonts, justified/centered text), and — more importantly —
// can carry arbitrary markup that bypasses the markdown converter's
// own URL sanitization entirely, unlike anything typed or imported
// through this app's own paths.
el("wysiwyg-editor").addEventListener("paste", (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, text);
});
// Native drag-and-drop has the same problem — dropped content can
// carry a browser's own rich HTML/URLs straight into the DOM. Direct
// users to the Upload/Attach toolbar buttons instead, which go
// through this app's own upload endpoint.
el("wysiwyg-editor").addEventListener("drop", (e) => {
  e.preventDefault();
});
el("wysiwyg-editor").addEventListener("change", (e) => {
  if (e.target && e.target.type === "checkbox") onEditingInput();
});

// ---------- format bar ----------
const ICONS = {
  bold: '<svg viewBox="0 0 20 20" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h5a3 3 0 0 1 0 6H6zM6 9h6a3.2 3.2 0 0 1 0 8H6z"/></svg>',
  italic: '<svg viewBox="0 0 20 20" stroke-width="1.7" stroke-linecap="round"><path d="M9 3h6M5 17h6M12 3 8 17"/></svg>',
  strike: '<svg viewBox="0 0 20 20" stroke-width="1.6" stroke-linecap="round"><path d="M4 10h12M7 6c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5M7 14c0 1.4 1.3 2.5 3 2.5s3-1.1 3-2.5"/></svg>',
  code: '<svg viewBox="0 0 20 20" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5 2 10l5 5M13 5l5 5-5 5"/></svg>',
  ul: '<svg viewBox="0 0 20 20" stroke-width="1.7" stroke-linecap="round"><circle cx="3.5" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="15" r="1" fill="currentColor" stroke="none"/><path d="M7 5h10M7 10h10M7 15h10"/></svg>',
  ol: '<svg viewBox="0 0 20 20" stroke-width="1.5" stroke-linecap="round"><text x="1" y="6.5" font-size="5.5" stroke="none" fill="currentColor">1</text><text x="1" y="11.5" font-size="5.5" stroke="none" fill="currentColor">2</text><text x="1" y="16.5" font-size="5.5" stroke="none" fill="currentColor">3</text><path d="M7 5h10M7 10h10M7 15h10"/></svg>',
  checklist: '<svg viewBox="0 0 20 20" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="5" height="5" rx="1"/><path d="M4 6l1 1 2-2"/><rect x="2.5" y="11.5" width="5" height="5" rx="1"/><path d="M10 6h8M10 14h8"/></svg>',
  indent: '<svg viewBox="0 0 20 20" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h14M3 16h14M3 10h6M12 6l4 4-4 4"/></svg>',
  outdent: '<svg viewBox="0 0 20 20" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h14M3 16h14M3 10h6M8 6l-4 4 4 4"/></svg>',
  quote: '<svg viewBox="0 0 20 20" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v14M8 6h9M8 10h9M8 14h6"/></svg>',
  codeblock: '<svg viewBox="0 0 20 20" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M7 8l-2 2 2 2M13 8l2 2-2 2"/></svg>',
  hr: '<svg viewBox="0 0 20 20" stroke-width="1.8" stroke-linecap="round"><path d="M3 10h14"/></svg>',
  footnote: '<svg viewBox="0 0 20 20" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h9l3 3M4 10h12M4 15h7"/><text x="14.5" y="8.5" font-size="6" stroke="none" fill="currentColor">n</text></svg>',
  link: '<svg viewBox="0 0 20 20" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M12 8a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1"/></svg>',
  image: '<svg viewBox="0 0 20 20" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><circle cx="7" cy="8" r="1.4" fill="currentColor" stroke="none"/><path d="M3 15l4.5-4.5 3 3L14.5 9l3 3"/></svg>',
  upload: '<svg viewBox="0 0 20 20" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13V3M6 7l4-4 4 4M3 15v1.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>',
  attach: '<svg viewBox="0 0 20 20" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6.5 7.8 11.7a2.5 2.5 0 0 0 3.5 3.5L17 9.5a4 4 0 0 0-5.7-5.7L5.6 9.5a5.5 5.5 0 0 0 7.8 7.8"/></svg>',
  table: '<svg viewBox="0 0 20 20" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M2.5 8.3h15M2.5 13h15M9.3 3.5v13"/></svg>',
};

const LABELS = {
  bold: "Bold", italic: "Italic", strike: "Strikethrough", code: "Inline code",
  ul: "Bullet list", ol: "Numbered list", checklist: "Checkbox list",
  indent: "Indent", outdent: "Outdent",
  quote: "Blockquote", codeblock: "Code block", hr: "Horizontal rule", footnote: "Footnote",
  link: "Link", image: "Image by URL", upload: "Upload image", attach: "Attach file", table: "Insert table",
};

const GROUPS = [
  ["bold", "italic", "strike", "code"],
  ["ul", "ol", "checklist", "outdent", "indent"],
  ["quote", "codeblock", "hr", "footnote"],
  ["link", "image", "upload", "attach", "table"],
];

function buildFormatBar() {
  const bar = el("format-bar");
  bar.innerHTML = "";

  const headingSelect = document.createElement("select");
  headingSelect.id = "heading-select";
  headingSelect.title = "Text style";
  headingSelect.setAttribute("aria-label", "Text style");
  ["Text style", "Paragraph", "Heading 1", "Heading 2", "Heading 3", "Heading 4", "Heading 5", "Heading 6"].forEach((label, i) => {
    const opt = document.createElement("option");
    opt.value = i === 0 ? "" : i === 1 ? "P" : "H" + (i - 1);
    opt.textContent = label;
    if (i === 0) { opt.disabled = true; opt.selected = true; }
    headingSelect.appendChild(opt);
  });
  bar.appendChild(headingSelect);
  bar.appendChild(sep());

  GROUPS.forEach((group) => {
    group.forEach((cmd) => {
      const btn = document.createElement("button");
      btn.dataset.cmd = cmd;
      btn.title = LABELS[cmd];
      btn.setAttribute("aria-label", LABELS[cmd]);
      btn.innerHTML = ICONS[cmd];
      bar.appendChild(btn);
    });
    bar.appendChild(sep());
  });

  const alertSelect = document.createElement("select");
  alertSelect.id = "alert-select";
  alertSelect.title = "GitHub-style callout";
  alertSelect.setAttribute("aria-label", "GitHub-style callout");
  ["Callout…", "Note", "Tip", "Important", "Warning", "Caution"].forEach((label, i) => {
    const opt = document.createElement("option");
    opt.value = i === 0 ? "" : label.toUpperCase();
    opt.textContent = label;
    if (i === 0) { opt.disabled = true; opt.selected = true; }
    alertSelect.appendChild(opt);
  });
  bar.appendChild(alertSelect);

  const imageInput = document.createElement("input");
  imageInput.type = "file";
  imageInput.id = "image-upload-input";
  imageInput.accept = "image/*";
  imageInput.style.display = "none";
  bar.appendChild(imageInput);

  const attachInput = document.createElement("input");
  attachInput.type = "file";
  attachInput.id = "attach-file-input";
  attachInput.style.display = "none";
  bar.appendChild(attachInput);

  function sep() {
    const s = document.createElement("span");
    s.className = "sep";
    return s;
  }
}
buildFormatBar();

el("format-bar").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const cmd = btn.dataset.cmd;
  const editor = el("wysiwyg-editor");
  editor.focus();
  const sel = window.getSelection();
  const selectedText = sel && sel.toString();

  if (cmd === "bold") document.execCommand("bold");
  else if (cmd === "italic") document.execCommand("italic");
  else if (cmd === "strike") document.execCommand("strikeThrough");
  else if (cmd === "quote") document.execCommand("formatBlock", false, "BLOCKQUOTE");
  else if (cmd === "codeblock") document.execCommand("formatBlock", false, "PRE");
  else if (cmd === "ul") document.execCommand("insertUnorderedList");
  else if (cmd === "ol") document.execCommand("insertOrderedList");
  else if (cmd === "indent") document.execCommand("indent");
  else if (cmd === "outdent") document.execCommand("outdent");
  else if (cmd === "hr") document.execCommand("insertHorizontalRule");
  else if (cmd === "footnote") {
    const n = nextFootnoteNumber();
    document.execCommand("insertHTML", false, '<sup class="footnote-ref" data-fn="' + n + '">' + n + "</sup>");
    const fnP = document.createElement("p");
    fnP.textContent = "[^" + n + "]: ";
    editor.appendChild(fnP);
  } else if (cmd === "checklist") {
    insertChecklistItem(selectedText);
  } else if (cmd === "code") {
    wrapSelectionInline("code");
  } else if (cmd === "link") {
    const rawUrl = prompt("Link URL:", "https://");
    if (!rawUrl) return;
    const url = sanitizeUrl(rawUrl);
    if (!selectedText) document.execCommand("insertHTML", false, '<a href="' + url + '">' + escapeHtml(url) + "</a>");
    else document.execCommand("createLink", false, url);
  } else if (cmd === "image") {
    const imgUrl = prompt("Image URL:", "https://");
    if (!imgUrl) return;
    const alt = prompt("Alt text (optional):", "") || "";
    document.execCommand("insertHTML", false, '<img src="' + sanitizeUrl(imgUrl) + '" alt="' + escapeHtml(alt) + '">');
  } else if (cmd === "upload") {
    el("image-upload-input").click();
    return;
  } else if (cmd === "attach") {
    el("attach-file-input").click();
    return;
  } else if (cmd === "table") {
    const cols = parseInt(prompt("How many columns?", "2"), 10) || 2;
    const rowsN = parseInt(prompt("How many rows (not counting header)?", "2"), 10) || 2;
    let t = "<table><thead><tr>";
    for (let c = 0; c < cols; c++) t += "<th>Header " + (c + 1) + "</th>";
    t += "</tr></thead><tbody>";
    for (let r = 0; r < rowsN; r++) {
      t += "<tr>";
      for (let c2 = 0; c2 < cols; c2++) t += "<td>&nbsp;</td>";
      t += "</tr>";
    }
    t += "</tbody></table><p></p>";
    document.execCommand("insertHTML", false, t);
  }
  onEditingInput();
});

el("heading-select").addEventListener("change", (e) => {
  const val = e.target.value;
  el("wysiwyg-editor").focus();
  document.execCommand("formatBlock", false, val);
  e.target.selectedIndex = 0;
  onEditingInput();
});

el("alert-select").addEventListener("change", (e) => {
  const type = e.target.value;
  el("wysiwyg-editor").focus();
  document.execCommand("insertHTML", false,
    '<div class="md-alert md-alert-' + type.toLowerCase() + '"><p class="md-alert-title">' +
    type.charAt(0) + type.slice(1).toLowerCase() + "</p><p>Add a note here.</p></div><p></p>");
  e.target.selectedIndex = 0;
  onEditingInput();
});

el("image-upload-input").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const { url } = await uploadFile(file);
    el("wysiwyg-editor").focus();
    document.execCommand("insertHTML", false, '<img src="' + sanitizeUrl(url) + '" alt="' + escapeHtml(file.name) + '">');
    onEditingInput();
  } catch (err) {
    alert(err.message);
  }
});

el("attach-file-input").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const { filename, url } = await uploadFile(file);
    el("wysiwyg-editor").focus();
    document.execCommand("insertHTML", false, '<a href="' + sanitizeUrl(url) + '">' + escapeHtml(filename) + "</a>");
    onEditingInput();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- undo / redo ----------
// A plain contenteditable's undo stack is native, browser-managed —
// no synthetic keyboard events or workarounds needed, unlike the
// ProseMirror-based editor this app used previously.
el("undo-btn").addEventListener("click", () => {
  const target = mode === "raw" ? el("raw-textarea") : el("wysiwyg-editor");
  target.focus();
  document.execCommand("undo");
});
el("redo-btn").addEventListener("click", () => {
  const target = mode === "raw" ? el("raw-textarea") : el("wysiwyg-editor");
  target.focus();
  document.execCommand("redo");
});

function scheduleSave() {
  el("save-indicator").textContent = "saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNote, 500);
}

async function saveNote() {
  if (!originalTitle) return;
  const newTitle = el("title-input").value.trim() || originalTitle;
  const content = currentMarkdown();

  try {
    const body = { content };
    if (newTitle !== originalTitle) body.new_title = newTitle;
    const result = await apiJson(`/notes/${encodeURIComponent(originalTitle)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    originalTitle = result.title;
    currentTitle = result.title;
    el("save-indicator").textContent = "saved";
    await loadNotes();
  } catch (e) {
    el("save-indicator").textContent = "error: " + e.message;
  }
}

const DELETE_ICON = el("delete-btn").innerHTML;
let deleteConfirming = false;
let deleteConfirmTimeout = null;

function resetDeleteButton() {
  deleteConfirming = false;
  clearTimeout(deleteConfirmTimeout);
  el("delete-btn").innerHTML = DELETE_ICON;
  el("delete-btn").classList.remove("confirming");
}

document.addEventListener("click", (e) => {
  if (deleteConfirming && !el("delete-btn").contains(e.target)) resetDeleteButton();
});

el("delete-btn").addEventListener("click", async (e) => {
  if (!currentTitle) return;

  if (!deleteConfirming) {
    e.stopPropagation();
    deleteConfirming = true;
    el("delete-btn").textContent = "Confirm";
    el("delete-btn").classList.add("confirming");
    clearTimeout(deleteConfirmTimeout);
    deleteConfirmTimeout = setTimeout(resetDeleteButton, 4000);
    return;
  }

  resetDeleteButton();
  await apiJson(`/notes/${encodeURIComponent(currentTitle)}`, { method: "DELETE" });
  currentTitle = null;
  originalTitle = null;
  el("editor").hidden = true;
  await loadNotes();
});

// ---------- mode toggle ----------
el("mode-wysiwyg").addEventListener("click", () => switchMode("wysiwyg"));
el("mode-raw").addEventListener("click", () => switchMode("raw"));

function switchMode(next) {
  if (next === mode) return;
  const markdown = currentMarkdown();
  mode = next;

  el("mode-wysiwyg").classList.toggle("active", mode === "wysiwyg");
  el("mode-raw").classList.toggle("active", mode === "raw");
  el("wysiwyg-editor").hidden = mode !== "wysiwyg";
  el("format-bar").hidden = mode !== "wysiwyg";
  el("raw-textarea").hidden = mode !== "raw";

  if (mode === "raw") {
    el("raw-textarea").value = markdown;
  } else {
    el("wysiwyg-editor").innerHTML = mdToHtml(markdown);
  }
}

// ---------- startup ----------
(async function init() {
  let status;
  try {
    status = await apiJson("/session");
  } catch (err) {
    showLogin();
    return;
  }
  if (status.logged_in) {
    showApp();
    try {
      await loadNotes();
    } catch (err) {
      console.error("Failed to load notes on page load:", err);
      alert("Logged in, but failed to load your notes: " + err.message + "\n\nCheck the browser console for details.");
    }
    return;
  }
  showLogin();
})();
