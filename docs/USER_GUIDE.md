# ZotSweep 1.0.0

An independent Zotero 10 plugin that reviews PDF attachments whose files are
missing locally and moves chosen entries to Zotero Trash. It does not require
ZotFile and does not rename or delete files from disk.

## Install

In Zotero, open Tools > Plugins, choose the gear menu, then Install Plugin From
File. Select ZotSweep_v1.0.0.xpi.

## Use

1. Select references or PDF attachment rows in Zotero.
2. Open Tools > ZotSweep, or right-click and choose Find missing PDFs.
3. Review the list. Change Scan to Current library to check the whole library.
4. Missing PDF attachments keeps their parent references. The checked option
   Include references with no attachments also selects unattached references.
   Uncheck it to keep those references.
5. Check the entries to remove and click Move selected to Trash.

An optional mode, References with all PDFs missing, moves whole references to
Trash. It checks all PDFs belonging to each reference, including PDFs outside
the selection. References with an available or unverified PDF and references
without PDFs but with other attachments are kept. Other attachments and notes follow their reference into
Trash under Zotero's normal behavior. Use Zotero Trash to restore entries.

## References with no attachments

This option is enabled by default and works in both PDF cleanup modes. It finds
bibliographic references with zero active attachments of any kind. Web links,
images and other non-PDF attachments count as attachments and protect the
reference from this rule. Trashed attachments do not count as active.

Notes do not count as attachments. References that have only notes are listed
with their note count; their notes follow the reference into Trash. Standalone
notes are never selected by this rule. The plugin checks again immediately
before cleanup, so adding an attachment after the scan protects that reference.

## File checks

The plugin checks stored and linked PDFs. It ignores web links and non-PDF
attachments. It excludes unresolved paths, read-only items, unavailable storage
folders/drives/shares, and file permission errors. Files marked for a Zotero
download are excluded by default; the review window has an explicit option to
include them. Existing PDFs are kept.

Missing locally does not establish that a file is permanently gone. Dropbox or
Zotero may still be syncing it. Review the list before using the Trash button.
The plugin rechecks each chosen entry immediately before moving it. If the file
has appeared, the path or parent changed, or the reference's PDF set changed,
that entry is kept until a new scan. No cleanup runs automatically on install,
startup or a schedule, and the plugin never empties Trash.

The drive/share availability check covers ordinary Windows drive letters and
UNC paths. On Unix-like systems a linked-file check uses the filesystem root;
it cannot reliably identify every disconnected mount beneath that root.
File sync completion and remote server copies cannot be inferred from a local
file check. The review and final recheck are local checks, not remote checks.

## Build and tests

Run python3 build.py to build the XPI using the Python standard library.
Run node --test tests/core.test.cjs for the logic tests. Those tests simulate
Windows paths and IO APIs; they are not native Windows integration tests.

The live integration harness runs only in a disposable Zotero 10.0.8 profile.
Set the string preference missingPDFTest.root to the project folder, ensure
research/ exists, install the XPI, load tests/live.js in the privileged main
window, then call runMissingPDFTests(). It creates synthetic records and exits
Zotero when complete. Never run the harness in your normal library.

See LEGACY_TEST_RESULTS.json for actual validation. Native Windows testing is not
available in the test environment. The manifest targets Zotero 10.0.x; automatic
plugin updates are disabled, so install later versions manually.

License: MIT. This is an unofficial plugin prepared for Loy.


## Branding release 1.0.0

Display names, dialogs, source documentation and build filenames use ZotSweep. Existing internal add-on IDs and storage keys are retained for compatibility. Functionality is unchanged. Historical validation files are prefixed LEGACY_; live Zotero/Windows validation has not been repeated for this rename.

If Zotero refuses to replace an installed 1.1.0 build with 1.0.0, remove the old add-on, restart Zotero, and install ZotSweep.
