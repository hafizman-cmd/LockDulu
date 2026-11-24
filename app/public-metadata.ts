import type { Metadata } from "next";
import { headers } from "next/headers";

type Preview = { src: string | null | undefined; alt: string };

function socialImage(previews: Preview[], origin?: string) {
  for (const { src, alt } of previews) {
    const url = src ? URL.parse(src, origin) : null;
    if (url && ["https:", "http:"].includes(url.protocol) && /\.(?:jpe?g|png|webp)$/i.test(url.pathname)) {
      return { url, alt };
    }
  }
}

async function publicOrigin() {
  const configured = process.env.APP_ORIGIN && URL.parse(process.env.APP_ORIGIN);
  if (configured && (configured.protocol === "https:" || configured.protocol === "http:")) {
    return configured.origin;
  }

  const request = await headers();
  const host = request.get("host");
  if (!host || !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d+)?$/i.test(host)) return undefined;
  const local = /^(?:localhost|127(?:\.\d+){3}|\[::1\])(?::\d+)?$/i.test(host);
  const protocol = request.get("x-forwarded-proto") === "http" || local ? "http" : "https";
  return URL.parse(`${protocol}://${host}`)?.origin;
}

export async function publicPageMetadata({
  path, title, description, previews,
}: { path: string; title: string; description: string; previews: Preview[] }): Promise<Metadata> {
  const origin = await publicOrigin();
  const photo = socialImage(previews, origin);
  const image = photo ?? { url: "/icon-512.png", alt: "LockDulu" };
  const url = origin ? new URL(path, origin).href : undefined;

  return {
    title,
    description,
    metadataBase: origin ? new URL(origin) : undefined,
    alternates: url ? { canonical: url } : undefined,
    openGraph: { type: "website", siteName: "LockDulu", title, description, url, images: [image] },
    twitter: { card: photo ? "summary_large_image" : "summary", title, description, images: [image] },
  };
}
