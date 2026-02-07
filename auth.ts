import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events";

// Auth.js requires AUTH_SECRET; in dev allow a fallback so the app doesn't crash
const authSecret =
  process.env.AUTH_SECRET ??
  (process.env.NODE_ENV === "development" ? "sf-events-dev-secret-change-in-production" : undefined);

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          scope: `openid email profile ${GOOGLE_CALENDAR_SCOPE}`,
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session as SessionWithToken).accessToken = token.accessToken as string | undefined;
        (session as SessionWithToken).refreshToken = token.refreshToken as string | undefined;
      }
      return session;
    },
  },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/" },
});

export interface SessionWithToken {
  user?: { name?: string | null; email?: string | null; image?: string | null };
  accessToken?: string;
  refreshToken?: string;
}

declare module "next-auth" {
  interface Session extends SessionWithToken {}
}
