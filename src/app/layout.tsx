import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { Chrome } from "@/components/Chrome";
import "./globals.css";

const plexThai = IBM_Plex_Sans_Thai({
  weight: ["300", "400", "500", "600"],
  subsets: ["thai", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ch.Lead FUN — Ch.Erawan Lead Follow-Up Nudger",
  description: "ระบบจัดการลูกค้าคาดหวังฝ่ายขาย · Ch. Erawan Group",
  icons: { icon: "/logo.png" },
};

// No in-app login yet (deferred): protection is LAN/Cloudflare-level. When
// auth lands, Chrome's sidebar sections hide/show per the signed-in role.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className={`${plexThai.className} min-h-screen`}>
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
