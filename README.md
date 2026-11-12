# ZotSweep

<img src="icons/logo.png" alt="ZotSweep logo" width="160" />

Review missing PDF attachments and references without attachments, then move selected records to Zotero Trash.

ZotSweep checks local file availability and shows a review list before cleanup. It supports both attachment-only cleanup and whole-reference cleanup, with a final check before moving selected records.

[Download ZotSweep 1.0.0](dist/ZotSweep_v1.0.0.xpi) · [User guide](docs/USER_GUIDE.md) · [Release notes](RELEASE_NOTES.md)

## Why ZotSweep?

Moving PDFs, reorganising linked folders or importing old libraries can leave Zotero records pointing to files that are no longer available. ZotSweep helps researchers inspect these records and decide what to move to Trash. It can also find references with no active attachments when maintaining a library centred on attached documents.

## Cleanup options

| Option | Behavior |
| --- | --- |
| Missing PDF attachments | Moves selected missing attachment records to Trash; keeps their parent references. |
| References with all PDFs missing | Moves selected whole references when every PDF is confirmed missing locally. Other attachments and notes follow the reference into Trash. |
| Include references with no attachments | Adds references with zero active attachments to the review list. Enabled by default in both modes. |

Notes do not count as attachments. A reference containing only notes can therefore be included by the no-attachments option; its notes follow it into Trash. Web links, images and other active attachments protect a reference from that particular rule. Standalone notes are excluded.

## Features

- Scan selected records or the current library.
- Check stored and linked PDF attachments.
- Review results and choose which records to move.
- Exclude unresolved paths, read-only records and file permission errors.
- Exclude unavailable storage locations when they can be identified.
- Exclude PDFs marked for Zotero download unless explicitly included.
- Recheck selected records before moving them to Trash.
- Restore moved entries through Zotero Trash.

## Install and use

1. Download the XPI above. If GitHub opens a file page, use its raw/download button.
2. In Zotero, open **Tools > Plugins > gear menu > Install Plugin From File**.
3. Select `ZotSweep_v1.0.0.xpi`.
4. Select references or attachments, then open **Tools > ZotSweep**, or right-click and choose **Find missing PDFs**.
5. Choose the scan scope and cleanup mode. Uncheck **Include references with no attachments** if you want to retain those references.
6. Run the scan, review the results, and click **Move selected to Trash** for the checked records.

No cleanup runs on installation, startup or a schedule. ZotSweep does not empty Trash or delete files from disk.

## Understand a missing-file result

Missing locally does not prove a PDF is permanently lost. A file may still be syncing or downloading. ZotSweep cannot inspect remote Dropbox or Zotero copies and does not recover, download or relink files.

A whole reference is protected when another PDF is available or cannot be verified. If a file appears, its link changes, or the relevant attachment set changes after scanning, the final recheck protects the record until another scan.

Windows location checks account for drive letters and UNC shares. On Unix-like systems, linked-file checks use the filesystem root and cannot reliably distinguish every disconnected mount beneath it. Review results for external and cloud storage with that limitation in mind.

## Compatibility and validation

The manifest targets Zotero 10.0.x. ZotSweep does not require ZotFile.

The 1.0.0 branding release passed 41 automated logic tests, JavaScript syntax checks, XHTML parsing and source/XPI parity checks. Windows path handling is simulated in tests; it is not native Windows integration testing. Earlier integration evidence is retained in `LEGACY_TEST_RESULTS.json`. Live Zotero and native Windows testing have not been repeated for this branding release.

The original add-on ID is retained. If Zotero refuses to replace the earlier 1.1.0 build with this 1.0.0 build, remove the older add-on, restart Zotero, then install ZotSweep.

## Build and test

Requires Python 3 for packaging and Node.js 18 or newer for automated tests.

```sh
node --test tests/core.test.cjs
python3 build.py
```

The build produces `dist/ZotSweep_v1.0.0.xpi`. Application files are at the repository root. `tests/live.js` is a privileged integration harness for a disposable Zotero profile only; see the user guide before using it.

## Privacy and maintenance

File checks run locally. The plugin uses Zotero's Trash API for record changes. Normal Zotero sync may propagate those changes. Automatic plugin updates are disabled; install later versions manually.

Licensed under [MIT](LICENSE). This is an independent plugin and is not affiliated with Zotero.

## Included logo

The generated ZotSweep logo is bundled with the plugin. The manifest supplies 48, 96 and 128 pixel transparent PNG icons for the Plugins manager. The full logo is included in the source. Version remains 1.0.0.
