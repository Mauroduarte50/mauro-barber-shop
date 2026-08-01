import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/providers";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://midominio.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Mauro Barber Shop — Reserva tu cita",
    template: "%s · Mauro Barber Shop",
  },
  description:
    "Reserva tu corte de cabello y barba en línea. Elige el servicio, la fecha y la hora que prefieras. Confirmación inmediata.",
  applicationName: "Mauro Barber Shop",
  openGraph: {
    type: "website",
    locale: "es_CO",
    siteName: "Mauro Barber Shop",
    title: "Mauro Barber Shop — Reserva tu cita",
    description: "Reserva tu corte en línea en segundos. Servicios, horarios y confirmación inmediata.",
    images: [`${SITE_URL}/images/hero.jpg`],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mauro Barber Shop — Reserva tu cita",
    description: "Reserva tu corte en línea en segundos.",
    images: [`${SITE_URL}/images/hero.jpg`],
  },
  icons: {
    icon: "/images/icon-192.png",
    apple: "/images/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    title: "Mauro Barber",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c0a09",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.classList.remove('dark')}else{document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}`,
          }}
        />
      </head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
