const APP_NAME_ALIASES: Record<string, string> = {
  snippingtool: "Snipping Tool",
  fileexplorer: "File Explorer",
  explorer: "File Explorer",
  microsoftedge: "Microsoft Edge",
  microsoftteams: "Microsoft Teams",
  microsoftoutlook: "Microsoft Outlook",
  windowsterminal: "Windows Terminal",
  powershell: "PowerShell",
  pwsh: "PowerShell",
  cmd: "Command Prompt",
  windowsshellexperiencehost: "Windows Shell Experience Host",
  code: "VS Code",
  visualstudiocode: "VS Code",
  claude: "Claude",
  chatgptatlas: "ChatGPT",
  chatgptdesktop: "ChatGPT",
  ticktick: "TickTick",
  systemsettings: "System Settings",
  daylenswindows: "Daylens",
  daylens: "Daylens",
  comet: "Comet",
};

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function normalizeAppNameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function formatDisplayAppName(rawName: string): string {
  const baseName = (rawName.split(/[\\/]/).pop() ?? rawName).trim();
  const stripped = baseName.replace(/\.(exe|app|lnk)$/i, "");
  const spaced = stripped
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const alias = APP_NAME_ALIASES[normalizeAppNameKey(spaced)];
  if (alias) return alias;
  if (!spaced) return rawName;
  return toTitleCase(spaced);
}

export function formatVisibleAppName(rawName: string | null | undefined): string | null {
  if (!rawName?.trim()) return null;
  const formatted = formatDisplayAppName(rawName);
  const key = normalizeAppNameKey(formatted);
  if (!key || key.startsWith("unknown") || key === "null" || key === "undefined") {
    return null;
  }
  return formatted;
}

export function appInitials(rawName: string): string {
  const displayName = formatVisibleAppName(rawName) ?? formatDisplayAppName(rawName);
  return displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
