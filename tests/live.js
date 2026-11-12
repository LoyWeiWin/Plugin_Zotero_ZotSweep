/* Run only inside a disposable Zotero profile; creates synthetic records. */
async function runMissingPDFTests() {
  const win = Zotero.getMainWindow(), { IOUtils, PathUtils } = win;
  const root = Services.prefs.getStringPref("missingPDFTest.root");
  const report = { zotero: Zotero.version, plugin: Zotero.MissingPDFCleaner?.version, platform: Zotero.isWin ? "Windows" : "Linux", checks: [] };
  const check = (value, label) => { if (!value) throw new Error(label); report.checks.push(label); dump("MISSING_PDF_CHECK: " + label + "\n"); };
  async function waitFor(callback, label) {
    for (let i = 0; i < 300; i++) { const result = await callback(); if (result) return result; await Zotero.Promise.delay(100); }
    throw new Error("Timed out: " + label);
  }
  const makeParent = async title => { const item = new Zotero.Item("journalArticle"); item.setField("title", title); await item.saveTx(); return item; };
  try {
    const runtime = await waitFor(() => Zotero.MissingPDFCleaner, "plugin startup");
    const core = runtime.core;
    check(!!win.document.getElementById("missing-pdf-cleaner-tools"), "XPI installs and adds its Tools command");
    check(!!win.document.getElementById("missing-pdf-cleaner-context"), "Attachment context command is installed");
    const parent = await makeParent("Synthetic reference with one available PDF");
    const fixture = PathUtils.join(root, "tests", "fixtures", "sample.pdf");
    const missing = await Zotero.Attachments.importFromFile({ file: fixture, parentItemID: parent.id });
    const missingPath = missing.getFilePath();
    const annotation = await Zotero.Annotations.saveFromJSON(missing, {
      key: Zotero.DataObjectUtilities.generateKey(), type: "highlight", color: "#ffd400", pageLabel: "1",
      sortIndex: "00000|000001|00100", position: { pageIndex: 0, rects: [[60, 740, 240, 755]] },
      text: "Keep this annotation", comment: "Preserve during soft Trash", isExternal: false
    });
    await IOUtils.remove(missingPath);
    const good = await Zotero.Attachments.importFromFile({ file: fixture, parentItemID: parent.id });
    const goodPath = good.getFilePath(), goodBytes = await IOUtils.read(goodPath);
    const pending = await Zotero.Attachments.importFromFile({ file: fixture, parentItemID: parent.id });
    await IOUtils.remove(pending.getFilePath()); pending.attachmentSyncState = "to_download"; await pending.saveTx();
    const linkedPath = PathUtils.join(root, "research", "linked-test.pdf");
    await IOUtils.copy(fixture, linkedPath);
    const linked = await Zotero.Attachments.linkFromFile({ file: linkedPath, parentItemID: parent.id });
    await IOUtils.remove(linkedPath);
    const web = await Zotero.Attachments.linkFromURL({ url: "https://example.invalid/paper.pdf", parentItemID: parent.id, title: "PDF web link" });
    const note = new Zotero.Item("note"); note.parentID = parent.id; note.setNote("<p>Keep this reference note.</p>"); await note.saveTx();
    let preview = await core.scan([parent]);
    check(preview.rows.filter(row => row.eligible).map(row => row.itemID).sort().join() === [missing.id, linked.id].sort().join(), "Stored and linked missing PDFs are identified together");
    check(preview.rows.find(row => row.itemID === good.id)?.status === "available", "An existing PDF is kept");
    check(preview.rows.find(row => row.itemID === pending.id)?.status === "pending", "A PDF waiting for Zotero download is excluded by default");
    check(!preview.rows.some(row => row.itemID === web.id), "PDF web links are excluded from local file cleanup");
    check(!missing.deleted && !linked.deleted && !parent.deleted, "Scanning does not move any item to Trash");
    const parentPreview = await core.scan([missing], { mode: "parents" });
    check(!parentPreview.rows[0].eligible, "Parent mode protects a reference with another existing PDF");
    const explicitPending = await core.scan([pending], { includePending: true });
    check(explicitPending.missing === 1, "Pending PDFs require the explicit include-downloads option");
    await IOUtils.copy(fixture, missingPath);
    const restored = await core.trash(preview, ["attachment:" + missing.id]);
    check(restored.trashed === 0 && restored.kept === 1 && !missing.deleted, "A file restored after scanning is rechecked and kept");
    await IOUtils.remove(missingPath);
    await waitFor(() => win.ZoteroPane.itemsView, "items view");
    await win.ZoteroPane.collectionsView.selectLibrary(Zotero.Libraries.userLibraryID); await win.ZoteroPane.onCollectionSelected();
    await win.ZoteroPane.itemsView.selectItems([parent.id]);
    const dialog = runtime.open(win);
    await waitFor(() => dialog.document.getElementById("summary")?.textContent.startsWith("Checked ") && !dialog.document.getElementById("scan").disabled, "review scan");
    check(dialog.document.getElementById("mode").value === "attachments", "Review window defaults to attachment-only cleanup");
    check(dialog.document.getElementById("include-empty").checked, "The no-attachments cleanup option is enabled by default");
    check(dialog.document.querySelectorAll("#rows input[type=checkbox]:enabled").length === 2, "Review lists the missing PDFs with selectable checkboxes");
    for (const row of dialog.document.querySelectorAll("#rows tr")) {
      const box = row.querySelector("input");
      if (Number(row.dataset.itemId) !== missing.id && box.checked) box.click();
    }
    check(dialog.document.getElementById("trash").textContent.includes("(1)"), "Checkbox selection controls the Trash count");
    try {
      const canvas = dialog.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = dialog.innerWidth; canvas.height = dialog.innerHeight;
      canvas.getContext("2d").drawWindow(dialog, 0, 0, canvas.width, canvas.height, "#ffffff");
      const data = canvas.toDataURL("image/png").split(",")[1];
      const bytes = Uint8Array.from(win.atob(data), ch => ch.charCodeAt(0));
      await IOUtils.write(PathUtils.join(root, "research", "review-qa.png"), bytes);
    } catch (error) { report.visual_capture = String(error); }
    dialog.document.getElementById("trash").click();
    await waitFor(() => dialog.document.getElementById("summary").textContent.startsWith("Moved 1"), "Trash command");
    check(missing.deleted && !linked.deleted, "The review Trash button moves only the checked PDF record");
    check(!parent.deleted && note.getNote().includes("Keep this reference note"), "Attachment cleanup preserves the parent reference and its note");
    const afterBytes = await IOUtils.read(goodPath);
    check(afterBytes.length === goodBytes.length && afterBytes.every((value, i) => value === goodBytes[i]), "Existing PDF file bytes are unchanged");
    check(missing.getAnnotations(true).some(item => item.key === annotation.key), "Annotations remain associated with the trashed attachment");
    missing.deleted = false; await missing.saveTx();
    check(!missing.deleted && missing.getAnnotations(true).some(item => item.key === annotation.key), "A trashed PDF record can be restored with its annotations");
    dialog.close();
    const orphan = await Zotero.Attachments.importFromFile({ file: fixture }); await IOUtils.remove(orphan.getFilePath());
    preview = await core.scan(await runtime.core.api.load(await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, false, false, true)));
    check(preview.rows.some(row => row.itemID === orphan.id && row.eligible), "Library scans include missing standalone PDFs");
    const onlyMissingParent = await makeParent("Synthetic reference with all PDFs missing");
    const child = await Zotero.Attachments.importFromFile({ file: fixture, parentItemID: onlyMissingParent.id }); await IOUtils.remove(child.getFilePath());
    const noPDFParent = await makeParent("Synthetic reference without PDFs");
    preview = await core.scan([onlyMissingParent, noPDFParent], { mode: "parents", includeEmpty: false });
    check(preview.rows.length === 1 && preview.rows[0].itemID === onlyMissingParent.id && preview.rows[0].eligible, "Parent cleanup lists only references whose PDFs are all missing");
    const parentResult = await core.trash(preview, [preview.rows[0].id]);
    check(parentResult.trashed === 1 && onlyMissingParent.deleted && !noPDFParent.deleted, "Explicit parent cleanup uses Zotero Trash and keeps references without PDFs");
    onlyMissingParent.deleted = false; await onlyMissingParent.saveTx();
    check(!onlyMissingParent.deleted && Zotero.Items.get(child.id).parentID === onlyMissingParent.id, "Parent references can be restored with their attachment relationships");
    const notesParent = await makeParent("Synthetic reference with notes and no attachments");
    const childNote = new Zotero.Item("note"); childNote.parentID = notesParent.id;
    childNote.setNote("<p>Keep this note on restore.</p>"); await childNote.saveTx();
    preview = await core.scan([noPDFParent, notesParent]);
    check(preview.empty === 2 && preview.missing === 0, "Unattached references appear separately from missing PDFs");
    check(preview.rows.find(row => row.itemID === notesParent.id)?.noteCount === 1, "The preview discloses notes on unattached references");
    const allPreview = await core.scan(await core.api.load(await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, false, false, true)));
    check(allPreview.rows.some(row => row.kind === "empty" && row.itemID === noPDFParent.id), "Whole-library scans include references with no attachments");
    const noAttachmentPreview = await core.scan([noPDFParent]);
    await Zotero.Attachments.linkFromURL({ url: "https://example.invalid/info", parentItemID: noPDFParent.id, title: "Keep this web attachment" });
    const changed = await core.trash(noAttachmentPreview, [noAttachmentPreview.rows[0].id]);
    check(changed.kept === 1 && !noPDFParent.deleted, "A newly added web attachment protects a reference after scanning");
    check((await core.scan([noPDFParent])).empty === 0, "Web attachments count as attachments for the new cleanup rule");
    await win.ZoteroPane.itemsView.selectItems([notesParent.id]);
    const emptyDialog = runtime.open(win);
    await waitFor(() => emptyDialog.document.getElementById("summary")?.textContent.startsWith("Checked ") && !emptyDialog.document.getElementById("scan").disabled, "unattached reference review");
    check(emptyDialog.document.getElementById("rows").textContent.includes("No attachments"), "The review window labels unattached references explicitly");
    const emptyOption = emptyDialog.document.getElementById("include-empty");
    emptyOption.click(); emptyDialog.document.getElementById("scan").click();
    await waitFor(() => emptyDialog.document.getElementById("summary").textContent.startsWith("Checked ") && !emptyDialog.document.getElementById("scan").disabled, "excluded unattached reference scan");
    check(emptyDialog.document.getElementById("trash").disabled && !notesParent.deleted, "Turning off the option protects unattached references in the review window");
    emptyOption.click(); emptyDialog.document.getElementById("scan").click();
    await waitFor(() => emptyDialog.document.getElementById("summary").textContent.startsWith("Checked ") && !emptyDialog.document.getElementById("scan").disabled, "included unattached reference scan");
    emptyDialog.document.getElementById("trash").click();
    await waitFor(() => emptyDialog.document.getElementById("summary").textContent.startsWith("Moved 1"), "unattached reference Trash action");
    check(notesParent.deleted && !noPDFParent.deleted, "The review action moves only the chosen unattached reference to Trash");
    notesParent.deleted = false; await notesParent.saveTx();
    check(notesParent.getNotes().includes(childNote.id) && childNote.getNote().includes("Keep this note on restore"), "Trashed unattached references restore with their notes intact");
    emptyDialog.close();
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const addon = await AddonManager.getAddonByID("missing-pdf-cleaner@local.zotero");
    await addon.disable();
    check(!Zotero.MissingPDFCleaner && !win.document.getElementById("missing-pdf-cleaner-tools"), "Disabling removes menus and runtime state");
    await addon.enable();
    check(!!Zotero.MissingPDFCleaner && !!win.document.getElementById("missing-pdf-cleaner-tools"), "The plugin re-enables cleanly");
    report.ok = true;
  }
  catch (error) { report.ok = false; report.error = String(error.message || error); report.stack = error.stack; Zotero.logError(error); }
  finally { await IOUtils.writeJSON(PathUtils.join(root, "research", "live-report.json"), report); Services.startup.quit(Ci.nsIAppStartup.eForceQuit); }
}
