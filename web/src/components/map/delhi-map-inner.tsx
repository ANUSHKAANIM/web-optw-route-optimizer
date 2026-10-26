"use client";

import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Circle, Polyline, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface DelhiMapRiskZone {
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
}

export interface DelhiMapPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  index: number;
}

export interface DelhiMapOtherPlayer {
  id: number;
  name: string;
  color: string;
  currentNode: number;
}

export interface DelhiMapProps {
  places: DelhiMapPlace[];
  currentRewards: number[];
  graphEdges: { from: number; to: number }[];
  depotIndex: number;
  feasibleNodes: number[];
  visitedPath: number[];
  recommendedPath: number[];
  /** The non-ML baseline heuristic's route from the current position, drawn
   * alongside the neural recommendation for a direct visual comparison. */
  baselinePath?: number[];
  /** A node the player just clicked, while the step request is still in
   * flight -- rendered with a pulsing ring for instant feedback that the
   * click registered, since the actual reroute takes a couple of seconds. */
  pendingNode?: number;
  currentNode: number;
  otherPlayers: DelhiMapOtherPlayer[];
  /** MOCK forecast risk zone (evacuation_sim mode only) -- rendered as a
   * clearly-labeled semi-transparent overlay, never presented as real data. */
  riskZone?: DelhiMapRiskZone;
  /** Node currently highlighted by the client-side simulation playback
   * (SimulationBar) -- a separate, purely visual marker from the real
   * current position. */
  simulatedNode?: number;
  onSelectNode?: (node: number) => void;
  interactive?: boolean;
  /** "neon" swaps the basemap for a dark CartoDB tile layer and applies a
   * glowing cyan/magenta palette to paths and markers. */
  theme?: "default" | "neon";
}

const NEON_CYAN = "#00f3ff";
const NEON_MAGENTA = "#ff0055";

const DELHI_CENTER: [number, number] = [28.6139, 77.209];

function rewardRadius(reward: number, maxReward: number): number {
  if (maxReward <= 0) return 6;
  const frac = Math.max(0, Math.min(1, reward / maxReward));
  return 6 + frac * 9;
}

export default function DelhiMapInner({
  places,
  currentRewards,
  graphEdges,
  depotIndex,
  feasibleNodes,
  visitedPath,
  recommendedPath,
  baselinePath,
  pendingNode,
  currentNode,
  otherPlayers,
  riskZone,
  simulatedNode,
  onSelectNode,
  interactive = true,
  theme = "default",
}: DelhiMapProps) {
  const neon = theme === "neon";
  const coordByIndex = useMemo(() => {
    const map = new Map<number, [number, number]>();
    for (const place of places) map.set(place.index, [place.latitude, place.longitude]);
    return map;
  }, [places]);

  const feasibleSet = useMemo(() => new Set(feasibleNodes), [feasibleNodes]);
  const visitedSet = useMemo(() => new Set(visitedPath), [visitedPath]);
  const maxReward = useMemo(() => Math.max(1, ...currentRewards), [currentRewards]);

  const visitedLine = visitedPath.map((n) => coordByIndex.get(n)).filter((c): c is [number, number] => !!c);
  const recommendedLine = recommendedPath
    .map((n) => coordByIndex.get(n))
    .filter((c): c is [number, number] => !!c);
  const baselineLine = (baselinePath ?? [])
    .map((n) => coordByIndex.get(n))
    .filter((c): c is [number, number] => !!c);

  return (
    <MapContainer center={DELHI_CENTER} zoom={11} scrollWheelZoom className="h-full w-full rounded-lg">
      {neon ? (
        // Esri's public ArcGIS Online tile service -- free, no API key.
        // Note the {z}/{y}/{x} order: ArcGIS REST tiles are y-before-x,
        // unlike the {z}/{x}/{y} XYZ convention every other layer here uses.
        <TileLayer
          attribution='Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors'
          url="https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        />
      ) : (
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      )}

      {riskZone && (
        <Circle
          center={[riskZone.centerLatitude, riskZone.centerLongitude]}
          radius={riskZone.radiusKm * 1000}
          pathOptions={{ color: "#dc2626", weight: 2, fillColor: "#dc2626", fillOpacity: 0.15, dashArray: "8 6" }}
        >
          <Tooltip direction="center" permanent className="!border-red-600 !bg-red-600/90 !text-white !font-semibold">
            SIMULATION / MOCK FORECAST
          </Tooltip>
        </Circle>
      )}

      {graphEdges.map((edge, i) => {
        const from = coordByIndex.get(edge.from);
        const to = coordByIndex.get(edge.to);
        if (!from || !to) return null;
        return (
          <Polyline
            key={`edge-${i}`}
            positions={[from, to]}
            pathOptions={{ color: "#94a3b8", weight: 1, opacity: 0.25 }}
          />
        );
      })}

      {baselineLine.length > 1 && (
        <Polyline
          positions={baselineLine}
          pathOptions={{
            color: neon ? "#22c55e" : "#22c55e",
            weight: 2.5,
            opacity: neon ? 0.85 : 0.7,
            dashArray: "2 8",
            className: neon ? "glow-green" : undefined,
          }}
        />
      )}

      {recommendedLine.length > 1 && (
        <Polyline
          positions={recommendedLine}
          pathOptions={{
            color: neon ? NEON_MAGENTA : "#f59e0b",
            weight: neon ? 3.5 : 3,
            opacity: 0.9,
            dashArray: "6 6",
            className: neon ? "glow-magenta" : undefined,
          }}
        />
      )}

      {visitedLine.length > 1 && (
        <Polyline
          positions={visitedLine}
          pathOptions={{
            color: neon ? NEON_CYAN : "#3b82f6",
            weight: 3.5,
            opacity: 0.95,
            className: neon ? "glow-cyan" : undefined,
          }}
        />
      )}

      {places.map((place) => {
        const isDepot = place.index === depotIndex;
        const isVisited = visitedSet.has(place.index);
        const isFeasible = feasibleSet.has(place.index);
        const isCurrent = place.index === currentNode;
        const reward = currentRewards[place.index] ?? 0;
        const clickable = interactive && isFeasible && !!onSelectNode;

        const color = isDepot
          ? neon
            ? NEON_MAGENTA
            : "#e11d48"
          : isVisited
            ? neon
              ? NEON_CYAN
              : "#3b82f6"
            : isFeasible
              ? neon
                ? "#39ff88"
                : "#10b981"
              : neon
                ? "#3f4a5c"
                : "#94a3b8";

        const glowClass = !neon
          ? undefined
          : isDepot
            ? "glow-magenta"
            : isVisited
              ? "glow-cyan"
              : isFeasible
                ? "glow-green"
                : undefined;

        return (
          <CircleMarker
            key={place.id}
            center={[place.latitude, place.longitude]}
            radius={isDepot ? 10 : rewardRadius(reward, maxReward)}
            pathOptions={{
              color: isCurrent ? (neon ? NEON_MAGENTA : "#facc15") : neon ? "#00000000" : "#00000066",
              weight: isCurrent ? 3 : 1,
              fillColor: color,
              fillOpacity: isVisited || isDepot ? 0.95 : isFeasible ? 0.85 : 0.35,
              className: glowClass,
            }}
            eventHandlers={clickable ? { click: () => onSelectNode!(place.index) } : undefined}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <span className="font-medium">{place.name}</span>
              {!isDepot && <span> · +{reward}</span>}
            </Tooltip>
          </CircleMarker>
        );
      })}

      {simulatedNode !== undefined &&
        coordByIndex.has(simulatedNode) &&
        (() => {
          const coord = coordByIndex.get(simulatedNode)!;
          return (
            <CircleMarker
              center={coord}
              radius={9}
              pathOptions={{
                color: "#ffffff",
                weight: 2,
                fillColor: NEON_MAGENTA,
                fillOpacity: 1,
                className: "glow-magenta-strong",
              }}
              interactive={false}
            />
          );
        })()}

      {pendingNode !== undefined &&
        coordByIndex.has(pendingNode) &&
        (() => {
          const coord = coordByIndex.get(pendingNode)!;
          return (
            <CircleMarker
              center={coord}
              radius={16}
              pathOptions={{
                color: "#facc15",
                weight: 3,
                fillColor: "#facc15",
                fillOpacity: 0.25,
                className: "animate-ping",
              }}
              interactive={false}
            />
          );
        })()}

      {otherPlayers.map((player) => {
        const coord = coordByIndex.get(player.currentNode);
        if (!coord) return null;
        return (
          <CircleMarker
            key={`player-${player.id}`}
            center={coord}
            radius={7}
            pathOptions={{ color: "#00000080", weight: 2, fillColor: player.color, fillOpacity: 1 }}
          >
            <Tooltip direction="right" permanent offset={[8, 0]} className="!text-[10px]">
              {player.name}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
