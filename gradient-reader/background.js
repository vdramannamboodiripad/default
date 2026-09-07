/* Gradient Reader — the service worker.
 *
 * Three jobs, and deliberately nothing else. A service worker that does more
 * than route is a service worker that has to be awake more often.
 *
 *   1. Get the content script into a page when somebody asks for it, using
 *      activeTab — the permission that means "the tab in front of you, right
 *      now, because you just pressed something".
 *
 *   2. Keep the list of registered content scripts in step with the domains
 *      the reader has enabled and granted permission for.
 *
 *   3. Put "on" on the toolbar badge when a page is being treated, so there is
 *      one honest indicator of whether the extension is doing anything.
 *
 * ---------------------------------------------------------------------------
 * ABOUT THE PERMISSIONS
 *
 * There is no <all_urls> in the manifest and there never should be. An
 * extension that reads the text of every page you visit is the most invasive
 * thing in this category, and asking for that up front is both the hardest
 * thing to justify to a Chrome Web Store reviewer and the easiest thing for a
 * reader to refuse.
 *
 * Instead: activeTab covers the deliberate click, and a per-origin permission
 * is requested — by the popup, from a real click — only when somebody says
 * "always on for this domain". Say no to that and the extension keeps working
 * exactly as before, one page at a time, on request.
 *
 * There is no network permission of any kind. Not a restricted one, none. The
 * extension cannot make a request, and that is checkable in thirty seconds by
 * anyone who opens manifest.json.
 */

const CONTENT_FILES = [
  'settings.js',
  'palettes.js',
  'engine.js',
  'detect.js',
  'content.js'
];

const CONTENT_CSS = ['content.css'];

/* -------------------------------------------------------------------------
 * INJECTING ON REQUEST
 * ---------------------------------------------------------------------- */

/* Is the content script already in this tab? A ping that gets no answer means
 * no, and sendMessage rejects rather than returning false, so this has to be
 * wrapped. */
async function isLoaded(tabId) {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    return !!(reply && reply.ok);
  } catch (error) {
    return false;
  }
}

async function inject(tabId) {
  // allFrames, because a lot of articles are inside a frame on the publisher's
  // own site. Chrome silently skips the frames we have no permission for,
  // which is the right outcome: a cross-origin frame needs its own grant.
  await chrome.scripting.insertCSS({
    target: { tabId, allFrames: true },
    files: CONTENT_CSS
  });
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: CONTENT_FILES
  });
}

/* Make sure the script is there, then tell it what to do.
 *
 *   action 'toggle'  flip whatever the page is currently doing
 *   action 'on'      turn it on
 *   action 'off'     turn it off
 *
 * A tab that had no script cannot have been on, so a toggle there becomes an
 * "on". Without that, the first press after injecting would turn the extension
 * off before it had ever been on. */
async function command(tabId, action) {
  const loaded = await isLoaded(tabId);

  // A page with no script in it is already off. Injecting one just to tell it
  // to be off would be work for nothing.
  if (!loaded && action === 'off') return { ok: true, on: false };

  if (!loaded) {
    try {
      await inject(tabId);
    } catch (error) {
      // No permission for this page: chrome://, the Web Store, a PDF viewer, a
      // file:// URL without "Allow access to file URLs". Nothing to be done
      // and nothing worth saying.
      return null;
    }
    if (action === 'toggle') action = 'on';
  }

  try {
    return await chrome.tabs.sendMessage(tabId, { type: action });
  } catch (error) {
    return null;
  }
}

/* -------------------------------------------------------------------------
 * THE BADGE
 * ---------------------------------------------------------------------- */

/* A tab can close between a page reporting its state and this running, and
 * setting a badge on a tab that no longer exists rejects. There is nothing to
 * recover, so the rejection is swallowed rather than left unhandled. */
function setBadge(tabId, on) {
  const ignore = () => {};
  Promise.resolve(chrome.action.setBadgeText({ tabId, text: on ? 'on' : '' }))
    .catch(ignore);
  Promise.resolve(chrome.action.setBadgeBackgroundColor({ tabId, color: '#3a5a7a' }))
    .catch(ignore);
}

/* -------------------------------------------------------------------------
 * REGISTERED CONTENT SCRIPTS
 *
 * A domain set to "on" gets a registered content script so the gradient is
 * simply there next time, with no click. That needs a host permission for the
 * domain, so the registration is only made when the permission is actually
 * held: the reader may have granted it and revoked it later from Chrome's own
 * extension settings, and Chrome does not ask us first.
 * ---------------------------------------------------------------------- */

const ID_PREFIX = 'gr-site-';

async function syncRegistrations() {
  const stored = await chrome.storage.local.get(['sites', 'settings']);
  const sites = stored.sites || {};
  const autoRun = !stored.settings || stored.settings.autoRun !== false;

  const wanted = new Map();
  if (autoRun) {
    for (const host of Object.keys(sites)) {
      if (sites[host] && sites[host].mode === 'on') {
        wanted.set(ID_PREFIX + host, '*://' + host + '/*');
      }
    }
  }

  // Drop anything we hold a registration for but no longer have permission
  // for. Registering without the permission throws, so this has to be checked
  // rather than assumed.
  for (const [id, pattern] of [...wanted]) {
    const granted = await chrome.permissions.contains({ origins: [pattern] });
    if (!granted) wanted.delete(id);
  }

  let existing = [];
  try {
    existing = await chrome.scripting.getRegisteredContentScripts();
  } catch (error) {
    existing = [];
  }

  const stale = existing
    .filter((script) => script.id.startsWith(ID_PREFIX) && !wanted.has(script.id))
    .map((script) => script.id);

  if (stale.length) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: stale });
    } catch (error) {
      // Already gone.
    }
  }

  const have = new Set(existing.map((script) => script.id));
  const toAdd = [];
  for (const [id, pattern] of wanted) {
    if (have.has(id)) continue;
    toAdd.push({
      id,
      matches: [pattern],
      js: CONTENT_FILES,
      css: CONTENT_CSS,
      runAt: 'document_idle',
      allFrames: true,
      persistAcrossSessions: true
    });
  }

  if (toAdd.length) {
    try {
      await chrome.scripting.registerContentScripts(toAdd);
    } catch (error) {
      console.warn('Gradient Reader: could not register', toAdd.map((s) => s.id), error);
    }
  }
}

/* -------------------------------------------------------------------------
 * WIRING
 * ---------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(async (details) => {
  await syncRegistrations();
  if (details.reason === 'install') {
    // The options page is where the sliders are, and calibrating is the whole
    // point — no configuration of this is universally best, so there is
    // nothing useful to default anybody into. This is the only time the
    // extension opens anything by itself.
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(syncRegistrations);

/* Chrome lets people revoke a host permission from the extensions page without
 * telling the extension first. When that happens the registration for that
 * domain has to go, or it sits there dead. */
chrome.permissions.onRemoved.addListener(syncRegistrations);
chrome.permissions.onAdded.addListener(syncRegistrations);

chrome.commands.onCommand.addListener(async (name, tab) => {
  if (name !== 'toggle-page' || !tab || tab.id === undefined) return;
  const result = await command(tab.id, 'toggle');
  if (result) setBadge(tab.id, result.on);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || !message.type) return;

  /* A page saying whether it is currently treated, for the badge. */
  if (message.type === 'page-state') {
    if (sender.tab && sender.tab.id !== undefined) {
      setBadge(sender.tab.id, message.on);
    }
    return;
  }

  /* The popup asking for something to happen in a tab. */
  if (message.type === 'command') {
    command(message.tabId, message.action).then((result) => {
      if (result) setBadge(message.tabId, result.on);
      respond(result);
    });
    return true;
  }

  /* The popup or options page saying the site list changed. */
  if (message.type === 'sites-changed') {
    syncRegistrations().then(() => respond({ ok: true }));
    return true;
  }
});

/* A tab that navigates away has lost its content script, so its badge is a
 * lie until the next page says otherwise. */
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') setBadge(tabId, false);
});
