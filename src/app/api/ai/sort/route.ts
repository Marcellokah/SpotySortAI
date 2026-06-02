import { authOptions } from "@/lib/auth";
import { getAllLikedTracks, getAllUserOwnedPlaylists, getCurrentUserProfile } from "@/lib/spotify";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type SortResult = {
  trackId: string;
  targetPlaylistId: string | null;
  suggestedNewPlaylistName: string | null;
};

function parseModelJson(text: string): SortResult[] {
  // Clean potential markdown blocks surrounding JSON
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
    // We only need the user's ID, existing playlists, and liked songs.
    // Fetch directly to avoid aggressive parallel track fetching of buildMusicLibrary.
    const userId = session.userId || (await getCurrentUserProfile(session.accessToken)).id;
    
    const rawPlaylists = await getAllUserOwnedPlaylists(session.accessToken, userId);
    
    // 1. Format existing strictly owned playlists
    const existingPlaylists = rawPlaylists.map((p) => ({
        id: p.id,
        name: p.name,
    }));

    const rawLikedSongs = await getAllLikedTracks(session.accessToken);

    // 2. Format liked songs
    const likedSongs = rawLikedSongs.map((t) => ({
      trackId: t.id,
      title: t.name,
      artistName: t.artists.map((a) => a.name).join(", "),
    }));

    // 3. Create bulk payload
    const payload = {
      existingPlaylists,
      likedSongs,
    };

    // 4. Construct the prompt with specific JSON array instructions
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
    
    // 5. Use gemini-2.5-flash for massive context capability
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash"
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        // Enforce JSON MIME type
        responseMimeType: "application/json"
      }
    });

    const responseText = result.response.text();
    const sortedTracks = parseModelJson(responseText);

    return NextResponse.json({
      success: true,
      data: sortedTracks,
    });
  } catch (error) {
    console.error("Sort route error:", error);
    const message = error instanceof Error ? error.message : "Gemini sort request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
