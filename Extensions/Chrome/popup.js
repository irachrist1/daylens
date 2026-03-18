/**
 * Activity Analyst — Chrome Extension Popup
 * Shows connection status and currently tracked site.
 */

async function updateStatus() {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const currentSite = document.getElementById("currentSite");
  const currentDomain = document.getElementById("currentDomain");

  try {
    const ws = new WebSocket("ws://localhost:19847");

    ws.onopen = () => {
      statusDot.className = "status-dot connected";
      statusText.textContent = "Connected to Activity Analyst";
      ws.close();
    };

    ws.onerror = () => {
      statusDot.className = "status-dot disconnected";
      statusText.textContent = "App not running";
    };
  } catch {
    statusDot.className = "status-dot disconnected";
    statusText.textContent = "App not running";
  }

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (tab && tab.url && !tab.url.startsWith("chrome://")) {
      const url = new URL(tab.url);
      const domain = url.hostname.replace(/^www\./, "");

      currentSite.style.display = "block";
      currentDomain.textContent = domain;
    }
  } catch {
    // No active tab info available
  }
}

updateStatus();
