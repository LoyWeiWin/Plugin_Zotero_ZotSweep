/* ZotSweep. MIT license. No writes occur during scanning. */
var MissingPDFCore = class {
  constructor(api) { this.api = api; }

  title(item) { return item.getField("title") || item.key || "Untitled"; }

  isPDF(item) {
    if (!item?.isAttachment()) return false;
    if (item.attachmentContentType === "application/pdf") return true;
    let name = "";
    try { name = item.attachmentFilename || ""; } catch {}
    if (!item.isFileAttachment()) name = item.getField("url") || "";
    return /\.pdf(?:[?#].*)?$/i.test(name);
  }

  async expanded(items) {
    const result = new Map();
    for (const item of items) {
      if (!item || item.deleted) continue;
      if (item.isAttachment()) result.set(item.id, item);
      else if (item.isRegularItem()) {
        for (const child of await this.api.load(item.getAttachments())) result.set(child.id, child);
      }
    }
    return [...result.values()];
  }

  async inspect(item, options = {}) {
    if (!this.isPDF(item) || item.deleted) return null;
    const parent = item.parentID ? (await this.api.load([item.parentID]))[0] : null;
    if (parent?.deleted) return null;
    const row = { id: "attachment:" + item.id, itemID: item.id, key: item.key,
      parentID: item.parentID || null, title: this.title(item),
      reference: parent ? this.title(parent) : "Standalone attachment", path: "",
      status: "unknown", eligible: false, reason: "", kind: "attachment" };
    const finish = (status, reason, eligible = false) => Object.assign(row, { status, reason, eligible });
    if (!item.isFileAttachment()) return finish("web", "Web link; file availability is not checked.");
    if (!this.api.editable(item)) return finish("readonly", "This item cannot be moved to Trash in this library.");
    try {
      row.path = item.getFilePath() || "";
      if (!row.path || !this.api.absolute(row.path)) return finish("unresolved", "The attachment path cannot be resolved.");
      const location = item.isStoredFileAttachment() ? this.api.storageRoot() : this.api.pathRoot(row.path);
      if (!location) return finish("unavailable", "The file's drive or location cannot be checked.");
      if (options.unavailableLocations?.has(location)) return finish("unavailable", "The storage folder, drive or network share is unavailable.");
      try {
        if ((await this.api.stat(location)).type !== "directory") {
          options.unavailableLocations?.add(location);
          return finish("unavailable", "The storage folder or drive is unavailable.");
        }
      }
      catch { options.unavailableLocations?.add(location); return finish("unavailable", "The storage folder, drive or network share is unavailable."); }
      try {
        const info = await this.api.stat(row.path);
        return finish("available", info.type === "directory" ? "The path points to a folder; review it in Zotero." : "File is available locally.");
      }
      catch (error) {
        if (error.name !== "NotFoundError") return finish("error", "Could not check this file: " + String(error.message || error));
      }
      if (item.isStoredFileAttachment() && this.api.downloadPending(item) && !options.includePending) {
        return finish("pending", "Waiting for a Zotero download; excluded from cleanup.");
      }
      return finish("missing", this.api.downloadPending(item)
        ? "Missing locally; Zotero marks this file for download." : "PDF file is missing locally.", true);
    }
    catch (error) { return finish("error", "Could not check this attachment: " + String(error.message || error)); }
  }

  async inspectParent(parentID, options) {
    const parent = (await this.api.load([parentID]))[0];
    if (!parent || !parent.isRegularItem() || parent.deleted) return null;
    const pdfs = (await this.api.load(parent.getAttachments())).filter(item => this.isPDF(item) && !item.deleted);
    if (!pdfs.length) return null;
    const checks = (await Promise.all(pdfs.map(item => this.inspect(item, options)))).filter(Boolean);
    const missing = checks.filter(row => row.eligible);
    const blocked = checks.find(row => !row.eligible);
    const row = { id: "parent:" + parent.id, itemID: parent.id, key: parent.key,
      parentID: null, title: this.title(parent), reference: this.title(parent),
      path: missing.map(row => row.path).join("\n"), kind: "parent", pdfCount: checks.length,
      fingerprint: checks.map(row => ({ itemID: row.itemID, key: row.key, path: row.path })),
      status: "missing", eligible: true, reason: "All " + checks.length + " PDF attachments are missing locally." };
    if (!this.api.editable(parent)) return Object.assign(row, { status: "readonly", eligible: false, reason: "This reference is read-only or this library has no Trash." });
    if (blocked || !missing.length) {
      return Object.assign(row, { status: blocked?.status || "unknown", eligible: false,
        reason: blocked?.status === "available" ? "A PDF is available; the reference will be kept."
          : "A PDF has not been verified missing: " + (blocked?.reason || "No missing PDFs.") });
    }
    return row;
  }

  async inspectEmptyParent(parentID) {
    const parent = (await this.api.load([parentID]))[0];
    if (!parent || !parent.isRegularItem() || parent.deleted || parent.getAttachments().length) return null;
    const noteCount = parent.getNotes?.().length || 0;
    const eligible = this.api.editable(parent);
    return { id: "empty:" + parent.id, itemID: parent.id, key: parent.key,
      parentID: null, title: this.title(parent), reference: this.title(parent),
      path: "", kind: "empty", pdfCount: 0, noteCount, fingerprint: [],
      status: eligible ? "empty" : "readonly", eligible,
      reason: eligible ? "No attachments." + (noteCount ? " " + noteCount + " note" + (noteCount === 1 ? "" : "s") + " will follow this reference to Trash." : "")
        : "This reference is read-only or this library has no Trash." };
  }

  async scan(items, options = {}) {
    options = { includeEmpty: true, ...options, unavailableLocations: new Set() };
    const expanded = await this.expanded(items);
    const pdfs = expanded.filter(item => this.isPDF(item));
    const parents = [...new Set(pdfs.map(item => item.parentID).filter(Boolean))];
    const emptyCandidates = options.includeEmpty ? [...new Set(items.filter(item => item && !item.deleted)
      .map(item => item.isRegularItem() ? item.id : item.parentID).filter(Boolean))] : [];
    const total = (options.mode === "parents" ? parents.length : pdfs.length) + emptyCandidates.length;
    let done = 0;
    const rows = [];
    if (options.mode === "parents") {
      for (let i = 0; i < parents.length; i++) {
        if (options.cancelled?.()) throw Object.assign(new Error("Scan cancelled."), { name: "AbortError" });
        const row = await this.inspectParent(parents[i], options);
        if (row) rows.push(row);
        options.progress?.(++done, total);
      }
    }
    else for (let i = 0; i < pdfs.length; i++) {
      if (options.cancelled?.()) throw Object.assign(new Error("Scan cancelled."), { name: "AbortError" });
      const row = await this.inspect(pdfs[i], options);
      if (row && row.status !== "web") rows.push(row);
      options.progress?.(++done, total);
    }
    for (const id of emptyCandidates) {
      if (options.cancelled?.()) throw Object.assign(new Error("Scan cancelled."), { name: "AbortError" });
      const row = await this.inspectEmptyParent(id);
      if (row) rows.push(row);
      options.progress?.(++done, total);
    }
    return { rows, options: { mode: options.mode || "attachments", includePending: !!options.includePending, includeEmpty: !!options.includeEmpty },
      checked: rows.length, missing: rows.filter(row => row.eligible && row.kind !== "empty").length,
      empty: rows.filter(row => row.eligible && row.kind === "empty").length,
      available: rows.filter(row => row.status === "available").length,
      excluded: rows.filter(row => !row.eligible && row.status !== "available").length };
  }

  sameSnapshot(before, after) {
    if (!after?.eligible || before.kind !== after.kind || before.key !== after.key || before.parentID !== after.parentID) return false;
    if (before.kind === "attachment") return this.api.samePath(before.path, after.path);
    if (before.fingerprint.length !== after.fingerprint.length) return false;
    return before.fingerprint.every(previous => after.fingerprint.some(current =>
      current.itemID === previous.itemID && current.key === previous.key && this.api.samePath(current.path, previous.path)));
  }

  async trash(preview, selectedIDs) {
    if (!Array.isArray(selectedIDs)) throw new Error("Select rows from a completed scan first.");
    const selected = new Set(selectedIDs), ready = [], results = [];
    for (const before of preview.rows.filter(row => row.eligible && selected.has(row.id))) {
      const current = before.kind === "empty" ? await this.inspectEmptyParent(before.itemID)
        : before.kind === "parent" ? await this.inspectParent(before.itemID, preview.options)
        : await this.inspect((await this.api.load([before.itemID]))[0], preview.options);
      if (!this.sameSnapshot(before, current)) {
        results.push({ id: before.id, itemID: before.itemID, status: "kept", reason: "Status changed since the scan. " + (current?.reason || "Rescan this item.") });
        continue;
      }
      ready.push(before.itemID);
      results.push({ id: before.id, itemID: before.itemID, status: "trashed", reason: "Moved to Zotero Trash." });
    }
    if (ready.length) await this.api.trash([...new Set(ready)]);
    return { results, trashed: ready.length, kept: results.filter(row => row.status === "kept").length };
  }
};
if (typeof module !== "undefined") module.exports = MissingPDFCore;
