const BASE_PATH = "/daylens";

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

export function apiPath(path: string): string {
  return withBasePath(path);
}
