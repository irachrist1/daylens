import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/app/lib/convex";
import { getSession } from "@/app/lib/session";
import { api } from "../../../../convex/_generated/api";

function extensionForKind(kind: string): string {
  switch (kind) {
    case "csv":
      return "csv";
    case "html_chart":
      return "html";
    case "markdown":
    case "report":
      return "md";
    case "json_table":
      return "json";
    default:
      return "txt";
  }
}

function mimeForKind(kind: string): string {
  switch (kind) {
    case "csv":
      return "text/csv; charset=utf-8";
    case "html_chart":
      return "text/html; charset=utf-8";
    case "json_table":
      return "application/json; charset=utf-8";
    case "markdown":
    case "report":
      return "text/markdown; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}

function sanitizeFilename(title: string, ext: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "daylens-artifact";
  return `${stem}.${ext}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { artifactId } = await params;
  const client = getConvexClient(session.token);
  const artifact = await client.query(api.webAiArtifacts.getArtifact, {
    workspaceArtifactId: artifactId,
  });

  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const ext = extensionForKind(artifact.kind);
  const filename = sanitizeFilename(artifact.title, ext);
  const download = request.nextUrl.searchParams.get("download") === "1";
  const disposition = `${download ? "attachment" : "inline"}; filename="${filename}"`;

  return new NextResponse(artifact.textContent ?? "", {
    headers: {
      "Content-Type": mimeForKind(artifact.kind),
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=60",
    },
  });
}
