const baseUrl = process.env.SMOKE_BASE_URL;
const sessionCookie = process.env.SMOKE_SESSION_COOKIE;

if (!baseUrl) {
  throw new Error("SMOKE_BASE_URL is required");
}

if (!sessionCookie) {
  throw new Error("SMOKE_SESSION_COOKIE is required");
}

const targets = [
  "/daylens/link",
  "/daylens/dashboard",
  "/daylens/apps",
  "/daylens/chat",
  "/daylens/settings",
  "/daylens/api/snapshots",
  "/daylens/api/workspace-status",
];

for (const target of targets) {
  const url = new URL(target, baseUrl).toString();
  const response = await fetch(url, {
    redirect: "manual",
    headers: {
      Cookie: sessionCookie,
    },
  });

  if (response.status >= 400) {
    throw new Error(`Smoke request failed for ${target}: ${response.status}`);
  }

  console.log(`${response.status} ${target}`);
}
