"use client";

import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";

export default function HomePage() {
  const { data: session, status } = useSession();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-6 py-12">
      <section className="w-full rounded-3xl border border-slate-200 bg-white/80 p-8 shadow-xl backdrop-blur">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-brand-700">Spotify Sorter</p>
        <h1 className="text-4xl font-bold leading-tight text-slate-900">
          Organize your liked songs with Spotify + Gemini
        </h1>
        <p className="mt-4 max-w-2xl text-slate-700">
          Connect Spotify, analyze your liked songs and playlist catalog, and get AI-generated sorting and
          refactoring suggestions before applying any changes.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          {!session ? (
            <button
              type="button"
              onClick={() => signIn("spotify")}
              className="rounded-full bg-brand-700 px-5 py-2.5 font-semibold text-white transition hover:bg-brand-900"
            >
              {status === "loading" ? "Checking session..." : "Connect Spotify"}
            </button>
          ) : (
            <>
              <Link
                href="/dashboard"
                className="rounded-full bg-brand-700 px-5 py-2.5 font-semibold text-white transition hover:bg-brand-900"
              >
                Open Dashboard
              </Link>
              <button
                type="button"
                onClick={() => signOut()}
                className="rounded-full border border-slate-300 bg-white px-5 py-2.5 font-semibold text-slate-700 transition hover:border-slate-500"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
