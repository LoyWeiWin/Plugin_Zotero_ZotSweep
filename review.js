"use strict";
window.addEventListener("DOMContentLoaded", () => {
  const model = window.arguments[0], $ = id => document.getElementById(id);
  let preview = null, selected = new Set(), busy = false, scanning = false;
  const h = (tag, text) => { const node = document.createElementNS("http://www.w3.org/1999/xhtml", tag); if (text !== undefined) node.textContent = text; return node; };
  if (!model.selectedCount) $("scope").value = "library";
  function controls() {
    for (const id of ["scope", "mode", "include-pending", "include-empty", "scan", "select-all"]) $(id).disabled = busy;
    $("mode-help").textContent = ($("mode").value === "parents"
      ? "References with all PDFs missing move to Trash with their attachments and notes. References with an available or unverified PDF are kept."
      : "Missing PDF attachment records move to Trash; their parent references are kept.")
      + ($("include-empty").checked ? " References with no attachments also move to Trash, including their notes." : "");
    $("stop").disabled = !scanning;
    $("trash").disabled = busy || !selected.size;
    $("trash").textContent = "Move selected to Trash" + (selected.size ? " (" + selected.size + ")" : "");
    $("selection").textContent = selected.size + " selected. Items can be restored from Zotero Trash.";
    const eligible = preview?.rows.filter(row => row.eligible) || [];
    $("select-all").checked = !!eligible.length && eligible.every(row => selected.has(row.id));
    $("select-all").indeterminate = !!selected.size && !$("select-all").checked;
  }
  function render() {
    $("rows").replaceChildren();
    const visible = (preview?.rows || []).filter(row => row.status !== "available" || $("show-available").checked);
    for (const row of visible) {
      const tr = h("tr"); tr.className = row.status; tr.dataset.itemId = String(row.itemID);
      const checkCell = h("td"), check = h("input"); check.type = "checkbox";
      check.checked = selected.has(row.id); check.disabled = busy || !row.eligible;
      check.setAttribute("aria-label", "Select " + row.reference + ": " + row.title);
      check.addEventListener("change", () => { if (check.checked) selected.add(row.id); else selected.delete(row.id); controls(); });
      checkCell.appendChild(check); tr.appendChild(checkCell);
      const reference = h("td"), link = h("button", row.reference); link.className = "reference";
      link.addEventListener("click", () => Promise.resolve(model.show(row.itemID)).catch(error => { $("summary").textContent = String(error.message || error); }));
      reference.appendChild(link); tr.appendChild(reference);
      tr.appendChild(h("td", row.kind === "empty" ? "No attachments" : row.kind === "parent" ? row.pdfCount + " PDF attachments" : row.title));
      const result = h("td", row.reason); result.className = "result"; tr.appendChild(result);
      const path = h("td", row.path || "—"); path.className = "path"; tr.appendChild(path);
      $("rows").appendChild(tr);
    }
    $("empty").hidden = !!visible.length;
    $("empty").textContent = preview ? "No matching items to move to Trash in this scan." : "Scan results appear here.";
    controls();
  }
  function reset() {
    preview = null; selected.clear();
    $("summary").textContent = "Settings changed. Scan to refresh the list.";
    render();
  }
  async function scan() {
    if (busy) return;
    busy = true; scanning = true; preview = null; selected.clear(); render();
    $("progress").hidden = false; $("progress").value = 0; $("summary").textContent = "Checking attachments and references…";
    try {
      preview = await model.scan({ scope: $("scope").value, mode: $("mode").value, includePending: $("include-pending").checked, includeEmpty: $("include-empty").checked },
        (done, total) => { $("progress").max = Math.max(1, total); $("progress").value = done; $("summary").textContent = "Checked " + done + " of " + total + "…"; });
      selected = new Set(preview.rows.filter(row => row.eligible).map(row => row.id));
      $("summary").textContent = "Checked " + preview.checked + ". Missing PDFs: " + preview.missing + "; no attachments: " + preview.empty + "; available: " + preview.available + "; excluded: " + preview.excluded + ".";
    }
    catch (error) { $("summary").textContent = error.name === "AbortError" ? "Scan stopped. No items were moved." : String(error.message || error); }
    finally { busy = false; scanning = false; $("progress").hidden = true; render(); }
  }
  $("scan").addEventListener("click", scan);
  $("stop").addEventListener("click", () => model.cancel());
  for (const id of ["scope", "mode", "include-pending", "include-empty"]) $(id).addEventListener("change", reset);
  $("show-available").addEventListener("change", render);
  $("select-all").addEventListener("change", () => {
    selected = new Set($("select-all").checked ? (preview?.rows || []).filter(row => row.eligible).map(row => row.id) : []); render();
  });
  $("trash").addEventListener("click", async () => {
    if (busy || !preview || !selected.size) return;
    busy = true; render(); $("summary").textContent = "Rechecking files before moving items to Trash…";
    try {
      const report = await model.trash([...selected]);
      for (const result of report.results) {
        const row = preview.rows.find(row => row.id === result.id);
        if (row) { row.eligible = false; row.status = result.status; row.reason = result.reason; }
      }
      selected.clear();
      $("summary").textContent = "Moved " + report.trashed + " to Zotero Trash. Kept " + report.kept + " after rechecking.";
    }
    catch (error) { preview = null; selected.clear(); $("summary").textContent = "Cleanup could not complete: " + String(error.message || error) + ". Scan again to refresh the list."; }
    finally { busy = false; render(); }
  });
  $("close").addEventListener("click", () => window.close());
  window.addEventListener("unload", () => model.done());
  render(); scan();
});
