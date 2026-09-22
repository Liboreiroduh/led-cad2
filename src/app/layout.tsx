import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LED JSON CAD — LED Collor",
  description:
    "CAD de estruturas para painéis LED dirigido por JSON: a IA lê o ProjectDocument, devolve um novo documento completo e o sistema valida, calcula o diff e mostra o preview 3D antes de aplicar.",
  keywords: ["CAD", "LED panel", "JSON", "AI", "estruturas metálicas", "LED Collor"],
  authors: [{ name: "LED Collor" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        {children}
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
