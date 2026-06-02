import { authOptions } from "@/lib/auth";
import { buildMusicLibrary } from "@/lib/spotify";
import { AiSortResponse, MusicLibraryPayload } from "@/lib/types";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

function parseModelJson(text: string): AiSortResponse {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const data = JSON.parse(cleaned) as AiSortResponse;

  return {
    summary: data.summary || "Generated playlist sorting plan.",
    assignments: Array.isArray(data.assignments) ? data.assignments : [],
    newPlaylists: Array.isArray(data.newPlaylists) ? data.newPlaylists : [],
    refactorSuggestions: Array.isArray(data.refactorSuggestions)
      ? data.refactorSuggestions
      : []
  };
}

function buildPrompt(library: MusicLibraryPayload): string {
  return [
    "You are a Spotify music curator assistant.",
    "Return strictly valid JSON and do not include markdown.",
    "Goal:",
    "1) Assign each liked song to the best existing playlist when it fits.",
    "2) If no playlist fits, propose a new playlist name.",
    "3) Suggest refactoring moves for misplaced tracks inside existing playlists.",
    "JSON schema:",
    JSON.stringify(
      {
        summary: "string",
        assignments: [
          {
            trackId: "string",
            trackName: "string",
            artistNames: ["string"],
            targetPlaylistId: "string optional if existing",
            targetPlaylistName: "string",
            reason: "string",
            action: "add_to_existing or create_new_playlist"
          }
        ],
        newPlaylists: [
          {
            name: "string",
            description: "string optional",
            trackIds: ["string"]
          }
        ],
        refactorSuggestions: [
          {
            trackId: "string",
            trackName: "string",
            fromPlaylistId: "string",
            fromPlaylistName: "string",
            toPlaylistId: "string",
            toPlaylistName: "string",
            reason: "string"
          }
        ]
      },
      null,
      2
    ),
    "Use the following music library data:",
    JSON.stringify(library)
  ].join("\n");
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
    const body = (await request.json().catch(() => ({}))) as {
      library?: MusicLibraryPayload;
    };

    const library = body.library ?? (await buildMusicLibrary(session.accessToken));

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.5-pro"
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: buildPrompt(library) }] }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    const responseText = result.response.text();
    const parsed = parseModelJson(responseText);

    return NextResponse.json({
      library,
      proposal: parsed
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini sort request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
