import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import "../(marketing)/styles.css";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-body",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`dashboard-layout ${ibmPlexSans.variable} ${spaceGrotesk.variable}`}>
      {children}
      {/* Add your live chat widget here if desired */}
    </div>
  );
}
