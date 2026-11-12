/* ZotSweep, MIT license. */
var cleanerScope, cleanerChrome;
function install() {}
function uninstall() {}
async function startup({ rootURI, version }) {
  cleanerChrome = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup)
    .registerChrome(Services.io.newURI(rootURI + "manifest.json"), [["content", "missing-pdf-cleaner", "./"]]);
  const { OS } = ChromeUtils.importESModule("chrome://zotero/content/osfile.mjs");
  cleanerScope = { Zotero, Services, IOUtils, PathUtils, OS };
  Services.scriptloader.loadSubScript(rootURI + "core.js", cleanerScope);
  Services.scriptloader.loadSubScript(rootURI + "runtime.js", cleanerScope);
  cleanerScope.MissingPDFRuntime.start(version);
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const addon = await AddonManager.getAddonByID("missing-pdf-cleaner@local.zotero");
  if (addon) addon.applyBackgroundUpdates = AddonManager.AUTOUPDATE_DISABLE;
}
function onMainWindowLoad({ window }) { cleanerScope?.MissingPDFRuntime.addWindow(window); }
function onMainWindowUnload({ window }) { cleanerScope?.MissingPDFRuntime.removeWindow(window); }
async function shutdown() {
  if (cleanerScope) await cleanerScope.MissingPDFRuntime.stop();
  cleanerScope = null;
  cleanerChrome?.destruct(); cleanerChrome = null;
}
