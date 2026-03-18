/**
 * Activity Analyst — Chrome/Chromium Background Service Worker
 *
 * Monitors active tab changes and URL navigation, then sends events
 * to the native Activity Analyst app via a local WebSocket connection.
 *
 * Protocol: JSON messages over ws://localhost:19847
 */

const WS_URL = "ws://localhost:19847";
const RECONNECT_INTERVAL = 5000;
const HEARTBEAT_INTERVAL = 30000;

let ws = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let isConnected = false;
let currentTabInfo = { url: "", title: "", domain: "" };

// --- WebSocket Connection ---

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      isConnected = true;
      clearInterval(reconnectTimer);
      reconnectTimer = null;

      sendMessage({
        type: "extensionInstalled",
        browser: detectBrowser(),
        timestamp: Date.now() / 1000,
      });

      startHeartbeat();
      sendCurrentTab();
    };

    ws.onclose = () => {
      isConnected = false;
      stopHeartbeat();
      scheduleReconnect();
    };

    ws.onerror = () => {
      isConnected = false;
    };

    ws.onmessage = (event) => {
      // Future: handle commands from the native app
    };
  } catch (e) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(connect, RECONNECT_INTERVAL);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    sendMessage({ type: "heartbeat", timestamp: Date.now() / 1000 });
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function sendMessage(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(data));
  } catch (e) {
    // Silently fail — reconnect will handle it
  }
}

// --- Tab Monitoring ---

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    handleTabChange(tab);
  } catch (e) {
    // Tab may have been closed
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title) {
    if (tab.active) {
      handleTabChange(tab);
    }
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) {
      handleTabChange(tab);
    }
  } catch (e) {
    // Window may have been closed
  }
});

function handleTabChange(tab) {
  if (!tab || !tab.url) return;

  // Skip internal browser pages
  if (
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("chrome-extension://") ||
    tab.url.startsWith("about:")
  ) {
    return;
  }

  const domain = extractDomain(tab.url);
  const isPrivate = tab.incognito || false;

  const isUrlChange =
    currentTabInfo.url !== tab.url && currentTabInfo.domain === domain;
  const isTabSwitch = currentTabInfo.domain !== domain;

  currentTabInfo = {
    url: tab.url,
    title: tab.title || "",
    domain: domain,
  };

  const messageType = isUrlChange ? "urlChanged" : "tabChanged";

  sendMessage({
    type: messageType,
    browser: detectBrowser(),
    url: isPrivate ? null : tab.url,
    title: isPrivate ? null : tab.title,
    domain: domain,
    isPrivate: isPrivate,
    timestamp: Date.now() / 1000,
  });
}

async function sendCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab) {
      handleTabChange(tab);
    }
  } catch (e) {
    // No active tab
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

function detectBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes("Arc")) return "arc";
  if (ua.includes("Brave")) return "brave";
  if (ua.includes("Edg/")) return "edge";
  if (ua.includes("OPR/") || ua.includes("Opera")) return "opera";
  if (ua.includes("Vivaldi")) return "vivaldi";
  if (ua.includes("Chrome")) return "chrome";
  return "chromium";
}

// --- Initialize ---

connect();
