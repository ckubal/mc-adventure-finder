"use client";

import { useUser } from "@/lib/user-context";

export function Header() {
  const { user, loading, signInWithGoogle, signOut } = useUser();

  return (
    <header 
      className="sticky top-0 z-10 flex items-center justify-between px-4 py-3"
      style={{
        background: "linear-gradient(90deg, #ff00ff, #00ffff, #ffff00, #ff00ff)",
        backgroundSize: "200% 100%",
        animation: "rainbow 3s linear infinite",
        borderBottom: "4px solid #000",
        boxShadow: "0 4px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.5)"
      }}
    >
      <div className="flex items-center gap-2">
        <h1 
          className="text-2xl font-bold"
          style={{
            fontFamily: "'Comic Sans MS', cursive",
            textShadow: "3px 3px 0px #fff, -1px -1px 0px #000",
            background: "linear-gradient(45deg, #ff00ff, #00ffff, #ffff00)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            animation: "rainbow 2s linear infinite"
          }}
        >
          ✨ m+c sf adventure finder ✨
        </h1>
        <span 
          className="text-lg"
          style={{
            animation: "blink 1s infinite"
          }}
        >
          🔥
        </span>
      </div>
      <div className="flex items-center gap-2">
        {loading ? (
          <span className="text-sm font-bold" style={{ color: "#000", textShadow: "1px 1px 0px #fff" }}>
            Loading…
          </span>
        ) : user ? (
          <>
            <span className="max-w-[140px] truncate text-sm font-bold" style={{ color: "#000", textShadow: "1px 1px 0px #fff" }}>
              {user.email}
            </span>
            <button
              type="button"
              onClick={() => signOut()}
              className="px-3 py-1.5 text-sm font-bold border-2 border-black"
              style={{
                background: "linear-gradient(135deg, #ffff00, #ff00ff)",
                color: "#000",
                textShadow: "1px 1px 0px #fff",
                boxShadow: "3px 3px 0px #000",
                transition: "all 0.1s"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translate(2px, 2px)";
                e.currentTarget.style.boxShadow = "1px 1px 0px #000";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translate(0, 0)";
                e.currentTarget.style.boxShadow = "3px 3px 0px #000";
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => signInWithGoogle()}
            className="px-3 py-1.5 text-sm font-bold border-2 border-black"
            style={{
              background: "linear-gradient(135deg, #00ffff, #ff00ff)",
              color: "#000",
              textShadow: "1px 1px 0px #fff",
              boxShadow: "3px 3px 0px #000",
              transition: "all 0.1s"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translate(2px, 2px)";
              e.currentTarget.style.boxShadow = "1px 1px 0px #000";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translate(0, 0)";
              e.currentTarget.style.boxShadow = "3px 3px 0px #000";
            }}
          >
            Sign in with Google
          </button>
        )}
      </div>
    </header>
  );
}
