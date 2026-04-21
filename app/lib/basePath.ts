export const BASE_PATH = "/daylens";

function normalizePath(path: string): string {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }
  return path;
}

export function withBasePath(path: string): string {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === BASE_PATH || normalizedPath.startsWith(`${BASE_PATH}/`)) {
    return normalizedPath;
  }
  return `${BASE_PATH}${normalizedPath}`;
}

export function stripBasePath(path: string): string {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === BASE_PATH) {
    return "/";
  }
  if (normalizedPath.startsWith(`${BASE_PATH}/`)) {
    return normalizedPath.slice(BASE_PATH.length) || "/";
  }
  return normalizedPath;
}

export function appPath(path: string): string {
  return withBasePath(path);
}

export function apiPath(path: string): string {
  return withBasePath(path);
}
