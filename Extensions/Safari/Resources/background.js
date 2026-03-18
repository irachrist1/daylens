/**
 * Activity Analyst — Safari Web Extension Background Script
 *
 * Uses native messaging (browser.runtime.sendNativeMessage) to communicate
 * with the host macOS app via App Groups, rather than WebSocket.
 *
 * Safari Web Extensions can use the nativeMessaging permission to send
 * messages directly to the containing app.
 */

const APP_IDENTIFIER = "com.activityanalyst.app";

let currentTabInfo = { url: "", title: "", domain: "" };

// --- Tab Monitoring ---

browser.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await browser.tabs.get(activeInfo.tabId);
    handleTabChange(tab);
  } catch (e) {
    // Tab may have been closed
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title) {
    if (tab.active) {
      handleTabChange(tab);
    }
  }
});

browser.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) return;
  try {
    const tabs = await browser.tabs.query({ active: true, windowId });
    if (tabs.length > 0) {
      handleTabChange(tabs[0]);
    }
  } catch (e) {
    // Window may have been closed
  }
});

function handleTabChange(tab) {
  if (!tab || !tab.url) return;

  // Skip internal Safari pages
  if (
    tab.url.startsWith("safari-web-extension://") ||
    tab.url.startsWith("about:")
  ) {
    return;
  }

  const domain = extractDomain(tab.url);

  const isUrlChange =
    currentTabInfo.url !== tab.url && currentTabInfo.domain === domain;

  currentTabInfo = {
    url: tab.url,
    title: tab.title || "",
    domain: domain,
  };

  const messageType = isUrlChange ? "urlChanged" : "tabChanged";

  sendToApp({
    type: messageType,
    browser: "safari",
    url: tab.url,
    title: tab.title,
    domain: domain,
    isPrivate: false,
    timestamp: Date.now() / 1000,
  });
}

// --- Communication with Native App ---

function sendToApp(message) {
  try {
    browser.runtime.sendNativeMessage(APP_IDENTIFIER, message, (response) => {
      // Handle response from native app if needed
    });
  } catch (e) {
    // Native messaging not available — fall back to WebSocket
    sendViaWebSocket(message);
  }
}

// Fallback WebSocket communication
let ws = null;

function sendViaWebSocket(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    try {
      ws = new WebSocket("ws://localhost:19847");
      ws.onopen = () => {
        ws.send(JSON.stringify(message));
      };
      ws.onerror = () => {
        ws = null;
      };
      ws.onclose = () => {
        ws = null;
      };
    } catch {
      // WebSocket also unavailable
    }
  } else {
    ws.send(JSON.stringify(message));
  }
}

// --- Utility ---

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

// --- Notify app on install ---

sendToApp({
  type: "extensionInstalled",
  browser: "safari",
  timestamp: Date.now() / 1000,
});
