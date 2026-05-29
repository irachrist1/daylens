import { withBasePath } from "./basePath";

export const MAC_DOWNLOAD_HREF = withBasePath("/api/download/mac");
export const WINDOWS_DOWNLOAD_HREF =
  process.env.NEXT_PUBLIC_DAYLENS_WINDOWS_STORE_URL?.trim() ||
  withBasePath("/api/download/windows");
export const LINUX_STATUS_HREF = withBasePath("/linux");

export const UNIFIED_DESKTOP_REPO_URL = "https://github.com/irachrist1/daylens";
export const UNIFIED_DESKTOP_ISSUES_URL =
  "https://github.com/irachrist1/daylens/blob/main/docs/ISSUES.md";
