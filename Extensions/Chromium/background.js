/**
 * DayLens Chromium Extension — background service worker
 *
 * Tracks active tab changes and posts structured visit events to the
 * DayLens macOS app on 127.0.0.1:27182.
 *
 * Covers: Chrome, Arc, Brave, Edge, Comet, and all Chromium-family browsers.
 */

const DAYLENS_ENDPOINT = "http://127.0.0.1:27182/visit";
const BROWSER_NAME = "chrome"; // Generic; overridden by UA detection below

// --- Utility ---

function getBrowserName() {
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "edge";
  if (ua.includes("Brave")) return "brave";
  // Arc doesn't expose itself in the UA, but we can detect it by extension context
  return "chrome";
}

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
    url.startsWith("chrome-extension://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://")
  );
}

// --- Posting ---

async function postVisit(payload) {
  try {
    await fetch(DAYLENS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // App not running or not reachable — silently ignore
  }
}

// --- Tab tracking ---

let currentTabId = null;

async function reportTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }

  if (!tab || !tab.url) return;
  if (isPrivateUrl(tab.url)) return;

  const domain = extractDomain(tab.url);
  if (!domain) return;

  const payload = {
    domain: domain,
    title: tab.title || null,
    url: tab.url,
    url_slug: extractUrlSlug(tab.url),
    browser: getBrowserName(),
    is_private: tab.incognito || false,
    timestamp: Date.now() / 1000,
  };

  await postVisit(payload);
}

// --- Event listeners ---

// Tab activated (user switches tabs)
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  currentTabId = tabId;
  await reportTab(tabId);
});

// Tab updated (navigation, title change)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId !== currentTabId) return;
  // Only report on status complete or title change to avoid duplicates during loading
  if (changeInfo.status === "complete" || changeInfo.title) {
    await reportTab(tabId);
  }
});

// Window focus changed (user switches browser windows)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    if (activeTab) {
      currentTabId = activeTab.id;
      await reportTab(activeTab.id);
    }
  } catch {
    // Window may have been closed
  }
});

// On startup, report the currently active tab
chrome.runtime.onStartup.addListener(async () => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (activeTab) {
    currentTabId = activeTab.id;
    await reportTab(activeTab.id);
  }
});
