import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "m+c sf adventure finder",
  description: "Find your next SF adventure — books, concerts, films, and more",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">
        <Providers>{children}</Providers>
        {/* The maker's mark. The still is the default and the video is opted
            INTO under prefers-reduced-motion, because autoplay cannot be
            called off from CSS. 31KB, not the 4.9MB GIF on the home site. */}
        <footer className="mt-10 pb-8 text-center text-[13px] text-neutral-500">
          <a
            href="https://weirdlittleideas.com"
            aria-label="weird little ideas"
            className="mx-auto block w-fit leading-none"
          >
            <img
              src="/wli-guy.jpg"
              width={400}
              height={224}
              alt="weird little ideas"
              loading="lazy"
              className="block w-[200px] h-auto rounded-[10px] border border-black/15 motion-safe:hidden"
            />
            <video
              width={400}
              height={224}
              autoPlay
              muted
              loop
              playsInline
              aria-hidden="true"
              poster="/wli-guy.jpg"
              className="hidden w-[200px] h-auto rounded-[10px] border border-black/15 motion-safe:block"
            >
              <source src="/wli-guy.mp4" type="video/mp4" />
            </video>
          </a>
          <p className="mt-2.5">
            a{" "}
            <a href="https://weirdlittleideas.com" className="underline underline-offset-2">
              weird little idea
            </a>{" "}
            by{" "}
            <a href="https://www.charliekubal.com/" className="underline underline-offset-2">
              charlie kubal
            </a>
          </p>
        </footer>
      </body>
    </html>
  );
}
