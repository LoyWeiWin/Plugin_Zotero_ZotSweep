/* Native Zotero adapter. Every cleanup uses Zotero.Items.trashTx. */
var MissingPDFRuntime = {
  windows: new Map(), dialogs: new Map(), sessions: new Set(), operations: new Set(), active: false,
  start(version) {
    this.version = version; this.active = true;
    this.core = new MissingPDFCore({
      load: async ids => {
        const items = ids.length ? (await Zotero.Items.getAsync(ids)).filter(Boolean) : [];
        if (items.length) await Zotero.Items.loadDataTypes(items, ["itemData", "childItems"]);
        return items;
      },
      editable: item => !!item.isEditable() && !!Zotero.Libraries.get(item.libraryID)?.hasTrash,
      absolute: path => PathUtils.isAbsolute(path), stat: path => IOUtils.stat(path),
      storageRoot: () => Zotero.getStorageDirectory().path,
      pathRoot: path => this.pathRoot(path), samePath: (a, b) => this.samePath(a, b),
      downloadPending: item => item.isStoredFileAttachment() && [
        Zotero.Sync.Storage.Local.SYNC_STATE_TO_DOWNLOAD, Zotero.Sync.Storage.Local.SYNC_STATE_FORCE_DOWNLOAD
      ].includes(item.attachmentSyncState),
      trash: ids => Zotero.Items.trashTx(ids)
    });
    Zotero.MissingPDFCleaner = this;
    for (const win of Zotero.getMainWindows()) this.addWindow(win);
  },
  comparisonPath(path) {
    let value = OS.Path.normalize(path);
    if (Zotero.isWin) value = value.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "").toLowerCase();
    return value;
  },
  samePath(a, b) { return this.comparisonPath(a) === this.comparisonPath(b); },
  pathRoot(path) {
    if (!PathUtils.isAbsolute(path)) return null;
    if (!Zotero.isWin) return "/";
    const normal = this.comparisonPath(path);
    const unc = normal.match(/^(\\\\[^\\]+\\[^\\]+)(?:\\|$)/);
    if (unc) return unc[1] + "\\";
    const drive = normal.match(/^[a-z]:\\/i);
    return drive ? drive[0] : null;
  },
  addWindow(win) {
    if (this.windows.has(win)) return;
    const menus = [];
    for (const [parent, id, label] of [
      ["menu_ToolsPopup", "missing-pdf-cleaner-tools", "ZotSweep…"],
      ["zotero-itemmenu", "missing-pdf-cleaner-context", "Find missing PDFs…"]
    ]) {
      const target = win.document.getElementById(parent);
      if (!target) continue;
      const entry = win.document.createXULElement("menuitem");
      entry.id = id; entry.setAttribute("label", label);
      entry.addEventListener("command", () => this.open(win));
      target.appendChild(entry); menus.push(entry);
    }
    if (menus.length) this.windows.set(win, menus);
  },
  removeWindow(win) {
    for (const menu of this.windows.get(win) || []) menu.remove();
    this.windows.delete(win);
    this.dialogs.get(win)?.close(); this.dialogs.delete(win);
  },
  open(win = Zotero.getMainWindow()) {
    if (!this.active) return;
    const previous = this.dialogs.get(win);
    if (previous && !previous.closed) { previous.focus(); return previous; }
    const session = { cancelled: false, preview: null, job: null };
    this.sessions.add(session);
    const pane = win.ZoteroPane;
    const model = {
      selectedCount: pane.getSelectedItems().length,
      scan: async (settings, progress) => {
        if (!this.active) throw new Error("The plugin is disabled.");
        if (session.job) session.job.cancelled = true;
        const job = { cancelled: false }; session.job = job;
        session.cancelled = false; session.preview = null;
        const libraryID = pane.getSelectedLibraryID();
        const items = settings.scope === "library"
          ? await this.core.api.load(await Zotero.Items.getAll(libraryID, false, false, true))
          : await this.core.api.load(pane.getSelectedItems().map(item => item.id));
        const preview = await this.core.scan(items, { ...settings, progress, cancelled: () => job.cancelled || session.cancelled || !this.active });
        if (job.cancelled || session.cancelled || !this.active) throw Object.assign(new Error("Scan cancelled."), { name: "AbortError" });
        session.preview = preview;
        return preview;
      },
      cancel: () => { session.cancelled = true; if (session.job) session.job.cancelled = true; session.preview = null; },
      trash: ids => {
        if (!this.active || !session.preview || session.cancelled) return Promise.reject(new Error("Run a completed scan first."));
        const operation = this.core.trash(session.preview, ids);
        this.operations.add(operation);
        operation.finally(() => this.operations.delete(operation)).catch(() => {});
        return operation;
      },
      show: async id => {
        const item = (await this.core.api.load([id]))[0];
        if (!item) return;
        await pane.collectionsView.selectLibrary(item.libraryID);
        await pane.onCollectionSelected(); await pane.itemsView.selectItems([id]); win.focus();
      },
      done: () => { session.cancelled = true; this.sessions.delete(session); this.dialogs.delete(win); }
    };
    const dialog = win.openDialog("chrome://missing-pdf-cleaner/content/review.xhtml", "missing-pdf-cleaner-review",
      "chrome,centerscreen,resizable,dialog=no,width=1160,height=760", model);
    this.dialogs.set(win, dialog); return dialog;
  },
  async stop() {
    this.active = false;
    for (const session of this.sessions) session.cancelled = true;
    await Promise.allSettled([...this.operations]);
    for (const win of [...this.windows.keys()]) this.removeWindow(win);
    this.sessions.clear();
    if (Zotero.MissingPDFCleaner === this) delete Zotero.MissingPDFCleaner;
  }
};
