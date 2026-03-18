/**
 * DayLens Safari Web Extension — background service worker
 *
 * Functionally identical to the Chromium extension, using the standard
 * WebExtensions API which Safari 17+ supports via Safari Web Extensions.
 */

const DAYLENS_ENDPOINT = "http://127.0.0.1:27182/visit";
const BROWSER_NAME = "safari";

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function extractUrlSlug(url) {
  try {
    const u = new URL(url);
    return u.pathname.length > 1 ? u.pathname : null;
  } catch {
    return null;
  }
}

function isPrivateUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("safari-extension://") ||
    url.startsWith("about:") ||
    url.startsWith("safari-web-extension://")
  );
}

async function postVisit(payload) {
  try {
    await fetch(DAYLENS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // DayLens not running — ignore
  }
}

async function reportTab(tabId) {
  let tab;
  try {
    tab = await browser.tabs.get(tabId);
  } catch {
    return;
  }

  if (!tab || !tab.url) return;
  if (isPrivateUrl(tab.url)) return;

  const domain = extractDomain(tab.url);
  if (!domain) return;

  // Safari exposes tab.incognito for private browsing windows
  const isPrivate = tab.incognito || false;

  const payload = {
    domain: isPrivate ? null : domain,
    title: isPrivate ? null : (tab.title || null),
    url: isPrivate ? null : tab.url,
    url_slug: isPrivate ? null : extractUrlSlug(tab.url),
    browser: BROWSER_NAME,
    is_private: isPrivate,
    timestamp: Date.now() / 1000,
  };

  await postVisit(payload);
}

let currentTabId = null;

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  currentTabId = tabId;
  await reportTab(tabId);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId !== currentTabId) return;
  if (changeInfo.status === "complete" || changeInfo.title) {
    await reportTab(tabId);
  }
});

browser.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) return;
  try {
    const [activeTab] = await browser.tabs.query({ active: true, windowId });
    if (activeTab) {
      currentTabId = activeTab.id;
      await reportTab(activeTab.id);
    }
  } catch {
    // Ignore
  }
});
