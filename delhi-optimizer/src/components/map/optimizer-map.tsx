"use client";

import OptimizerMapInner, { type OptimizerMapProps, type MapVanMarker, type Bounds } from "./optimizer-map-inner";

// Plain SVG, no mapping library and no window/document dependency at
// import time -- this wrapper exists only to keep the stable import path
// other components already use (@/components/map/optimizer-map).
export type { OptimizerMapProps, MapVanMarker, Bounds };

export function OptimizerMap(props: OptimizerMapProps) {
  return <OptimizerMapInner {...props} />;
}
