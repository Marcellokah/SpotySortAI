import { authOptions } from "@/lib/auth";
import { buildMusicLibrary } from "@/lib/spotify";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const library = await buildMusicLibrary(session.accessToken, session.userId);
    return NextResponse.json(library);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch library";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
