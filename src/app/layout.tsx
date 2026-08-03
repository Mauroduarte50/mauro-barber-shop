import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/providers";
import { getDefaultBarber, getAppSettings } from "@/lib/settings";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://midominio.com";

// Metadata reads the business name from the DB on every request — without
// this, Next.js would prerender metadata once at build time for any fully
// static route (e.g. /login, /reservar) and freeze whatever name existed
// then, so a later change in /admin/settings would never show there.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const barber = await getDefaultBarber();
  const settings = await getAppSettings(barber?.id ?? "");
  const name = settings.businessName || "Barbería";

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: `${name} — Reserva tu cita`,
      template: `%s · ${name}`,
    },
    description:
      "Reserva tu corte de cabello y barba en línea. Elige el servicio, la fecha y la hora que prefieras. Confirmación inmediata.",
    applicationName: name,
    openGraph: {
      type: "website",
      locale: "es_CO",
      siteName: name,
      title: `${name} — Reserva tu cita`,
      description: "Reserva tu corte en línea en segundos. Servicios, horarios y confirmación inmediata.",
      images: [`${SITE_URL}/images/hero.jpg`],
    },
    twitter: {
      card: "summary_large_image",
      title: `${name} — Reserva tu cita`,
      description: "Reserva tu corte en línea en segundos.",
      images: [`${SITE_URL}/images/hero.jpg`],
    },
    icons: {
      icon: "/images/icon-192.png",
      apple: "/images/icon-192.png",
    },
    appleWebApp: {
      capable: true,
      title: name,
      statusBarStyle: "black-translucent",
    },
  };
}

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
