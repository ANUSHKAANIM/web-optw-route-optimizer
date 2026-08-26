import type { DecoderState } from "@/lib/services/inference.service";

/** Plain-JSON form of a DecoderState (Float32Array -> number[]), for
 * persistence and for transport between the client and API routes. */
export interface DecoderStateSnapshot {
  hLstm: number[];
  cLstm: number[];
  prevHE: number[];
  currentEmbedding: number[];
}

export function snapshotDecoderState(state: DecoderState): DecoderStateSnapshot {
  return {
    hLstm: Array.from(state.hLstm),
    cLstm: Array.from(state.cLstm),
    prevHE: Array.from(state.prevHE),
    currentEmbedding: Array.from(state.currentEmbedding),
  };
}

export function restoreDecoderState(snapshot: DecoderStateSnapshot): DecoderState {
  return {
    hLstm: Float32Array.from(snapshot.hLstm),
    cLstm: Float32Array.from(snapshot.cLstm),
    prevHE: Float32Array.from(snapshot.prevHE),
    currentEmbedding: Float32Array.from(snapshot.currentEmbedding),
  };
}
