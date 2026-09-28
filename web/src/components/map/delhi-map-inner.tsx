"use client";

import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";

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
  currentNode: number;
  otherPlayers: DelhiMapOtherPlayer[];
  onSelectNode?: (node: number) => void;
  interactive?: boolean;
}

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
  currentNode,
  otherPlayers,
  onSelectNode,
  interactive = true,
}: DelhiMapProps) {
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

  return (
    <MapContainer center={DELHI_CENTER} zoom={11} scrollWheelZoom className="h-full w-full rounded-lg">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

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

      {recommendedLine.length > 1 && (
        <Polyline
          positions={recommendedLine}
          pathOptions={{ color: "#f59e0b", weight: 3, opacity: 0.85, dashArray: "6 6" }}
        />
      )}

      {visitedLine.length > 1 && (
        <Polyline positions={visitedLine} pathOptions={{ color: "#3b82f6", weight: 3.5, opacity: 0.9 }} />
      )}

      {places.map((place) => {
        const isDepot = place.index === depotIndex;
        const isVisited = visitedSet.has(place.index);
        const isFeasible = feasibleSet.has(place.index);
        const isCurrent = place.index === currentNode;
        const reward = currentRewards[place.index] ?? 0;
        const clickable = interactive && isFeasible && !!onSelectNode;

        const color = isDepot
          ? "#e11d48"
          : isVisited
            ? "#3b82f6"
            : isFeasible
              ? "#10b981"
              : "#94a3b8";

        return (
          <CircleMarker
            key={place.id}
            center={[place.latitude, place.longitude]}
            radius={isDepot ? 10 : rewardRadius(reward, maxReward)}
            pathOptions={{
              color: isCurrent ? "#facc15" : "#00000066",
              weight: isCurrent ? 3 : 1,
              fillColor: color,
              fillOpacity: isVisited || isDepot ? 0.95 : isFeasible ? 0.85 : 0.35,
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
