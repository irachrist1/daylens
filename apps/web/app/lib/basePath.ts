export const BASE_PATH = process.env.NODE_ENV === "production" ? "/daylens" : "";

function normalizePath(path: string): string {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }
  return path;
}

export function withBasePath(path: string): string {
  const normalizedPath = normalizePath(path);
  if (!BASE_PATH) {
    return normalizedPath;
  }
  if (normalizedPath === BASE_PATH || normalizedPath.startsWith(`${BASE_PATH}/`)) {
    return normalizedPath;
  }
  return `${BASE_PATH}${normalizedPath}`;
}

export function stripBasePath(path: string): string {
  const normalizedPath = normalizePath(path);
  if (!BASE_PATH) {
    return normalizedPath;
  }
  if (normalizedPath === BASE_PATH) {
    return "/";
  }
  if (normalizedPath.startsWith(`${BASE_PATH}/`)) {
    return normalizedPath.slice(BASE_PATH.length) || "/";
  }
  return normalizedPath;
}

export function appPath(path: string): string {
  // For Next.js app navigation helpers such as Link, router.push, and redirect.
  // Next applies `basePath` automatically for these internal routes.
  return normalizePath(path);
}

export function apiPath(path: string): string {
  return withBasePath(path);
}

export function assetPath(path: string): string {
  return withBasePath(path);
}
