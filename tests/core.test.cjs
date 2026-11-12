/* Logic tests use simulated Windows paths/IO, not a native Windows runtime. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.existsSync(path.join(__dirname, '../source/core.js')) ? '../source/' : '../';
const Core = require(source + 'core.js');
const context = vm.createContext({ Zotero: { isWin: true }, OS: { Path: path.win32 }, PathUtils: { isAbsolute: path.win32.isAbsolute } });
vm.runInContext(fs.readFileSync(path.join(__dirname, source, 'runtime.js'), 'utf8'), context);
const runtime = context.MissingPDFRuntime;

function setup() {
  const items = new Map(), entries = new Map(), errors = new Map(), trashCalls = [], stats = [];
  let nextID = 1;
  const key = value => runtime.comparisonPath(value);
  const put = (name, type = 'regular') => entries.set(key(name), { type });
  put('C:\\', 'directory'); put('C:\\Zotero\\storage', 'directory');
  const api = {
    load: async ids => ids.map(id => items.get(id)).filter(Boolean),
    editable: item => !item.readonly,
    absolute: path.win32.isAbsolute,
    storageRoot: () => 'C:\\Zotero\\storage',
    pathRoot: name => runtime.pathRoot(name), samePath: (a, b) => runtime.samePath(a, b),
    downloadPending: item => item.stored && [1, 4].includes(item.syncState),
    stat: async name => {
      stats.push(name);
      if (errors.has(key(name))) throw Object.assign(new Error('Access denied'), { name: errors.get(key(name)) });
      if (!entries.has(key(name))) throw Object.assign(new Error('Not found'), { name: 'NotFoundError' });
      return entries.get(key(name));
    },
    trash: async ids => { trashCalls.push(ids); for (const id of ids) items.get(id).deleted = true; }
  };
  const core = new Core(api);
  const parent = (title = 'Reference') => {
    const item = { id: nextID++, key: 'P' + nextID, deleted: false, children: [],
      isAttachment: () => false, isRegularItem: () => true,
      getAttachments() { return this.children.filter(id => !items.get(id).deleted); }, getField: () => title };
    items.set(item.id, item); return item;
  };
  const attachment = (owner = null, options = {}) => {
    const item = { id: nextID++, key: 'A' + nextID, parentID: owner?.id || null,
      stored: true, path: 'C:\\Zotero\\storage\\KEY\\missing.pdf', deleted: false, syncState: 0,
      attachmentContentType: 'application/pdf', url: '', ...options,
      isAttachment: () => true, isRegularItem: () => false,
      isFileAttachment() { return !this.web; }, isStoredFileAttachment() { return this.stored; },
      getFilePath() { return this.path; },
      getField(field) { return field === 'url' ? this.url : 'PDF'; },
      get attachmentFilename() { return this.path ? path.win32.basename(this.path) : 'missing.pdf'; }
    };
    items.set(item.id, item); owner?.children.push(item.id); return item;
  };
  return { core, api, items, entries, errors, trashCalls, stats, key, put, parent, attachment };
}

test('a missing stored PDF is eligible without changing the library during scan', async () => {
  const e = setup(), p = e.parent(), a = e.attachment(p);
  const result = await e.core.scan([p]);
  assert.equal(result.missing, 1); assert.equal(result.rows[0].itemID, a.id);
  assert.equal(a.deleted, false); assert.equal(e.trashCalls.length, 0);
});
test('a real file is kept, including one whose filename contains spaces and Unicode', async () => {
  const e = setup(), a = e.attachment(null, { path: 'C:\\My Papers\\Étude 中文.PDF' }); e.put(a.path);
  const r = await e.core.scan([a]); assert.equal(r.missing, 0); assert.equal(r.available, 1);
});
test('parent and child selections are deduplicated', async () => {
  const e = setup(), p = e.parent(), a = e.attachment(p);
  const r = await e.core.scan([p, a, a]); assert.equal(r.rows.length, 1);
});
test('HTML snapshots and PDF web links do not become file-cleanup candidates', async () => {
  const e = setup(), p = e.parent();
  e.attachment(p, { path: 'C:\\page.html', attachmentContentType: 'text/html' });
  e.attachment(p, { web: true, stored: false, url: 'https://example.invalid/paper.pdf' });
  const r = await e.core.scan([p]); assert.equal(r.rows.length, 0);
});
test('unattached references stay protected when their cleanup option is off', async () => {
  const e = setup(), p = e.parent(); const r = await e.core.scan([p], { mode: 'parents', includeEmpty: false });
  assert.equal(r.rows.length, 0);
});
test('references with no attachments are included by default', async () => {
  const e = setup(), p = e.parent(); const r = await e.core.scan([p]);
  assert.equal(r.empty, 1); assert.equal(r.missing, 0); assert.equal(r.rows[0].kind, 'empty');
  assert.equal(r.rows[0].itemID, p.id); assert.equal(p.deleted, false);
});
test('the no-attachments option also applies in whole-reference PDF mode', async () => {
  const e = setup(), p = e.parent(); const r = await e.core.scan([p], { mode: 'parents' });
  assert.equal(r.empty, 1);
});
test('turning off the option excludes unattached references in attachment mode', async () => {
  const e = setup(), p = e.parent(); const r = await e.core.scan([p], { includeEmpty: false });
  assert.equal(r.empty, 0); assert.equal(r.rows.length, 0);
});
test('a non-PDF attachment protects a reference from no-attachments cleanup', async () => {
  const e = setup(), p = e.parent();
  e.attachment(p, { path: 'C:\\photo.jpg', attachmentContentType: 'image/jpeg' });
  const r = await e.core.scan([p]); assert.equal(r.empty, 0); assert.equal(r.rows.length, 0);
});
test('a web link counts as an attachment for no-attachments cleanup', async () => {
  const e = setup(), p = e.parent();
  e.attachment(p, { web: true, url: 'https://example.invalid/info', attachmentContentType: 'text/html' });
  const r = await e.core.scan([p]); assert.equal(r.empty, 0);
});
test('references with notes but no attachments show that their notes follow them to Trash', async () => {
  const e = setup(), p = e.parent(); p.getNotes = () => [100, 101];
  const r = await e.core.scan([p]); assert.equal(r.empty, 1); assert.equal(r.rows[0].noteCount, 2);
  assert.match(r.rows[0].reason, /2 notes will follow/);
});
test('a new non-PDF attachment after scanning protects an unattached reference', async () => {
  const e = setup(), p = e.parent(); const r = await e.core.scan([p]);
  e.attachment(p, { path: 'C:\\new.txt', attachmentContentType: 'text/plain' });
  const result = await e.core.trash(r, [r.rows[0].id]);
  assert.equal(result.kept, 1); assert.equal(result.trashed, 0); assert.equal(p.deleted, false);
});
test('references with only trashed attachments have no active attachments', async () => {
  const e = setup(), p = e.parent(); e.attachment(p, { deleted: true });
  const r = await e.core.scan([p]); assert.equal(r.empty, 1);
});
test('standalone notes are never treated as unattached references', async () => {
  const e = setup(), note = { id: 500, deleted: false, isRegularItem: () => false, isAttachment: () => false };
  const r = await e.core.scan([note]); assert.equal(r.rows.length, 0);
});
test('read-only unattached references cannot be selected for Trash', async () => {
  const e = setup(), p = e.parent(); p.readonly = true; const r = await e.core.scan([p]);
  assert.equal(r.empty, 0); assert.equal(r.rows[0].eligible, false);
});
test('standalone missing PDFs can be moved to Trash without affecting other items', async () => {
  const e = setup(), a = e.attachment(), p = e.parent(); const r = await e.core.scan([a, p]);
  const result = await e.core.trash(r, [r.rows[0].id]); assert.equal(result.trashed, 1); assert.equal(p.deleted, false);
});
for (const state of [1, 4]) test('Zotero download state ' + state + ' is excluded by default', async () => {
  const e = setup(), a = e.attachment(null, { syncState: state }); const r = await e.core.scan([a]);
  assert.equal(r.rows[0].status, 'pending'); assert.equal(r.missing, 0);
});
test('including pending downloads requires the explicit scan option', async () => {
  const e = setup(), a = e.attachment(null, { syncState: 1 });
  const r = await e.core.scan([a], { includePending: true }); assert.equal(r.missing, 1);
  assert.match(r.rows[0].reason, /marks this file for download/);
});
test('unavailable storage blocks cleanup and is probed only once per scan', async () => {
  const e = setup(); e.entries.delete(e.key('C:\\Zotero\\storage'));
  const r = await e.core.scan([e.attachment(), e.attachment()]);
  assert.equal(r.missing, 0); assert.equal(r.rows[0].status, 'unavailable');
  assert.equal(e.stats.filter(name => name === 'C:\\Zotero\\storage').length, 1);
});
test('a disconnected drive is excluded instead of being treated as a missing file', async () => {
  const e = setup(), a = e.attachment(null, { stored: false, path: 'D:\\Research\\paper.pdf' });
  const r = await e.core.scan([a]); assert.equal(r.rows[0].status, 'unavailable');
});
test('an offline UNC share is excluded', async () => {
  const e = setup(), a = e.attachment(null, { stored: false, path: '\\\\Server\\Share\\paper.pdf' });
  const r = await e.core.scan([a]); assert.equal(r.missing, 0); assert.equal(r.rows[0].status, 'unavailable');
});
test('permission failures are not classified as missing files', async () => {
  const e = setup(), a = e.attachment(); e.errors.set(e.key(a.path), 'NotAllowedError');
  const r = await e.core.scan([a]); assert.equal(r.rows[0].status, 'error'); assert.equal(r.missing, 0);
});
test('unresolved relative attachment paths are excluded', async () => {
  const e = setup(), a = e.attachment(null, { path: false }); const r = await e.core.scan([a]);
  assert.equal(r.rows[0].status, 'unresolved');
});
test('read-only items cannot be trashed', async () => {
  const e = setup(), a = e.attachment(null, { readonly: true }); const r = await e.core.scan([a]);
  const result = await e.core.trash(r, ['attachment:' + a.id]); assert.equal(result.trashed, 0);
});
test('a parent with another available PDF is protected', async () => {
  const e = setup(), p = e.parent(); e.attachment(p); const good = e.attachment(p, { path: 'C:\\good.pdf' }); e.put(good.path);
  const r = await e.core.scan([p], { mode: 'parents' }); assert.equal(r.missing, 0); assert.match(r.rows[0].reason, /PDF is available/);
});
test('parent mode checks all PDFs even if only one child was selected', async () => {
  const e = setup(), p = e.parent(), missing = e.attachment(p); const good = e.attachment(p, { path: 'C:\\good.pdf' }); e.put(good.path);
  const r = await e.core.scan([missing], { mode: 'parents' }); assert.equal(r.missing, 0);
});
test('a PDF web link prevents automatic selection of its parent', async () => {
  const e = setup(), p = e.parent(); e.attachment(p); e.attachment(p, { web: true, url: 'https://example.invalid/paper.pdf' });
  const r = await e.core.scan([p], { mode: 'parents' }); assert.equal(r.missing, 0);
});
test('a parent whose PDFs are all missing appears once in parent mode', async () => {
  const e = setup(), p = e.parent(); e.attachment(p); e.attachment(p);
  const r = await e.core.scan([p], { mode: 'parents' });
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].kind, 'parent'); assert.equal(r.rows[0].pdfCount, 2); assert.equal(r.missing, 1);
});
test('a PDF restored after scanning is kept when cleanup rechecks it', async () => {
  const e = setup(), a = e.attachment(); const r = await e.core.scan([a]); e.put(a.path);
  const result = await e.core.trash(r, [r.rows[0].id]); assert.equal(result.trashed, 0); assert.equal(result.kept, 1); assert.equal(a.deleted, false);
});
test('relinking an attachment after scanning requires a rescan', async () => {
  const e = setup(), a = e.attachment(); const r = await e.core.scan([a]); a.path = 'C:\\different.pdf';
  const result = await e.core.trash(r, [r.rows[0].id]); assert.equal(result.kept, 1);
});
test('moving an attachment to another reference after scanning requires a rescan', async () => {
  const e = setup(), a = e.attachment(); const r = await e.core.scan([a]); a.parentID = e.parent().id;
  const result = await e.core.trash(r, [r.rows[0].id]); assert.equal(result.kept, 1);
});
test('a new PDF added after a parent scan protects the reference', async () => {
  const e = setup(), p = e.parent(); e.attachment(p); const r = await e.core.scan([p], { mode: 'parents' });
  e.attachment(p, { path: 'C:\\new-missing.pdf' });
  const result = await e.core.trash(r, [r.rows[0].id]); assert.equal(result.kept, 1); assert.equal(p.deleted, false);
});
test('already trashed items and children of trashed parents are ignored', async () => {
  const e = setup(), p = e.parent(), a = e.attachment(p); p.deleted = true;
  const standalone = e.attachment(null, { deleted: true });
  const r = await e.core.scan([a, standalone]); assert.equal(r.rows.length, 0);
});
test('only checked rows from the preview may be trashed', async () => {
  const e = setup(), first = e.attachment(), second = e.attachment(); const r = await e.core.scan([first, second]);
  const result = await e.core.trash(r, ['attachment:' + first.id, 'attachment:999999']);
  assert.equal(result.trashed, 1); assert.equal(second.deleted, false); assert.equal(e.trashCalls[0].length, 1);
});
test('cancelling a scan performs no trash operation', async () => {
  const e = setup(); await assert.rejects(e.core.scan([e.attachment()], { cancelled: () => true }), { name: 'AbortError' });
  assert.equal(e.trashCalls.length, 0);
});
test('cleanup uses only the Trash API and does not remove filesystem entries', async () => {
  const e = setup(), a = e.attachment(); e.put('C:\\unrelated.pdf'); const before = e.entries.size;
  const r = await e.core.scan([a]); await e.core.trash(r, [r.rows[0].id]);
  assert.equal(a.deleted, true); assert.equal(e.entries.size, before); a.deleted = false; assert.equal(a.deleted, false);
});
for (const [name, input, root] of [
  ['drive', 'C:\\Papers\\file.pdf', 'c:\\'],
  ['UNC', '\\\\Server\\Share\\file.pdf', '\\\\server\\share\\'],
  ['extended UNC', '\\\\?\\UNC\\Server\\Share\\file.pdf', '\\\\server\\share\\'],
  ['extended drive', '\\\\?\\C:\\Papers\\file.pdf', 'c:\\']
]) test('Windows location checks identify the ' + name + ' root', () => assert.equal(runtime.pathRoot(input), root));
