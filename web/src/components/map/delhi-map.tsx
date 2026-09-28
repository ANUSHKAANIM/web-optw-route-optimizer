"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { DelhiMapProps } from "@/components/map/delhi-map-inner";

// Leaflet touches `window`/`document` at import time, so it can only ever
// render on the client -- loaded via next/dynamic with ssr disabled rather
// than a plain import.
const DelhiMapInner = dynamic(() => import("@/components/map/delhi-map-inner"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
});

export type { DelhiMapProps };

export function DelhiMap(props: DelhiMapProps) {
  return <DelhiMapInner {...props} />;
}
