"use client";

import OptimizerMapInner, { type OptimizerMapProps } from "./optimizer-map-inner";

// Plain SVG, no mapping library and no window/document dependency at
// import time -- this wrapper exists only to keep the stable import path
// other components already use (@/components/map/optimizer-map).
export type { OptimizerMapProps };

export function OptimizerMap(props: OptimizerMapProps) {
  return <OptimizerMapInner {...props} />;
}
