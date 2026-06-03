import { authOptions } from "@/lib/auth";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Attempt to increase Vercel max duration (works on Pro, ignored on Hobby)

type SortResult = {
  trackId: string;
  targetPlaylistId: string | null;
  suggestedNewPlaylistName: string | null;
};

function parseModelJson(text: string): SortResult[] {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as SortResult[];
  } catch (error) {
    console.error("Failed to parse Gemini response:", cleaned);
    throw new Error("Invalid JSON response from AI");
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "Missing GEMINI_API_KEY environment variable" },
      { status: 500 }
    );
  }

  try {
    const { playlists, tracksChunk } = await request.json();

    if (!playlists || !tracksChunk || !Array.isArray(tracksChunk)) {
      return NextResponse.json({ error: "Invalid payload format" }, { status: 400 });
    }

    const payload = {
      existingPlaylists: playlists,
      likedSongs: tracksChunk,
    };

    const prompt = [
      "You are a music curator assistant.",
      "Sort the provided 'likedSongs' into the 'existingPlaylists'.",
      "If a song fits an existing playlist, set its 'targetPlaylistId' and set 'suggestedNewPlaylistName' to null.",
      "If a song does not fit well into any existing playlist, suggest a new playlist name in 'suggestedNewPlaylistName' and set 'targetPlaylistId' to null.",
      "Return ONLY a JSON array in the exact following format:",
      `[
  {
    "trackId": "string",
    "targetPlaylistId": "string or null",
    "suggestedNewPlaylistName": "string or null"
  }
]`,
      "Payload:",
      JSON.stringify(payload),
    ].join("\n");

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });

    const responseText = result.response.text();
    const sortedChunk = parseModelJson(responseText);

    return NextResponse.json({
      success: true,
      data: sortedChunk,
    });
  } catch (error) {
    console.error("Sort route error:", error);
    const message = error instanceof Error ? error.message : "Gemini sort request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
