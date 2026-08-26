import path from "node:path";
import type * as OrtTypes from "onnxruntime-node";

/**
 * Manages the ONNX inference session for the trained PointerNetwork.
 * The exported graph performs one full decision step: LSTM cell update +
 * masked pointing-network forward pass (see model/export_to_onnx.py).
 *
 * `onnxruntime-node` is loaded via a lazy `import()`, not a top-level
 * `import`, so that routes which never actually run inference (e.g. GET
 * /history, GET /runs/[id]) don't pull in its native binary at all. That
 * matters on Vercel: the binary must be explicitly included in
 * `outputFileTracingIncludes` (native addons aren't statically traceable),
 * and doing that for every route that merely imports this module
 * transitively -- rather than only the few that actually call it -- was
 * enough extra "functions" to trip the Hobby plan's 12-function cap.
 */

const HIDDEN_DIM = 128;
// Lives inside this Next.js app's root (model/optw_model.onnx) -- NOT in the
// repo's top-level model/ folder -- so Vercel's build/deploy includes it.
// Regenerate from the repo root with: ./rl_env/Scripts/python.exe model/export_to_onnx.py
const MODEL_PATH = path.join(process.cwd(), "model", "optw_model.onnx");

let ortModulePromise: Promise<typeof OrtTypes> | null = null;
function getOrt(): Promise<typeof OrtTypes> {
  if (!ortModulePromise) ortModulePromise = import("onnxruntime-node");
  return ortModulePromise;
}

let sessionPromise: Promise<OrtTypes.InferenceSession> | null = null;
function getSession(): Promise<OrtTypes.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = getOrt().then((ort) => ort.InferenceSession.create(MODEL_PATH));
  }
  return sessionPromise;
}

export interface DecoderState {
  hLstm: Float32Array;
  cLstm: Float32Array;
  prevHE: Float32Array; // (numNodes * HIDDEN_DIM), row-major
  currentEmbedding: Float32Array;
}

export function initialDecoderState(numNodes: number): DecoderState {
  return {
    hLstm: new Float32Array(HIDDEN_DIM),
    cLstm: new Float32Array(HIDDEN_DIM),
    prevHE: new Float32Array(numNodes * HIDDEN_DIM),
    currentEmbedding: new Float32Array(HIDDEN_DIM),
  };
}

export interface StepInferenceInput {
  staticFeats: number[][];
  dynamicFeats: number[][];
  adjMask: boolean[][];
  mask: boolean[];
  decoderState: DecoderState;
}

export interface StepInferenceOutput {
  probs: number[];
  nextDecoderState: DecoderState;
}

/** Runs one forward pass of the model: given the current environment state
 * and decoder memory, returns per-node selection probabilities and the
 * updated decoder memory to carry into the next step. */
export async function runInferenceStep(input: StepInferenceInput): Promise<StepInferenceOutput> {
  const [session, ort] = await Promise.all([getSession(), getOrt()]);
  const numNodes = input.staticFeats.length;

  const feeds: Record<string, OrtTypes.Tensor> = {
    static_feats: new ort.Tensor("float32", flatten(input.staticFeats), [1, numNodes, 7]),
    dynamic_feats: new ort.Tensor("float32", flatten(input.dynamicFeats), [1, numNodes, 9]),
    adj_mask: new ort.Tensor("bool", flattenBool(input.adjMask), [1, numNodes, numNodes]),
    mask: new ort.Tensor("bool", boolArray(input.mask), [1, numNodes]),
    prev_h_e: new ort.Tensor("float32", input.decoderState.prevHE, [1, numNodes, HIDDEN_DIM]),
    current_embedding: new ort.Tensor("float32", input.decoderState.currentEmbedding, [1, HIDDEN_DIM]),
    h_lstm: new ort.Tensor("float32", input.decoderState.hLstm, [1, HIDDEN_DIM]),
    c_lstm: new ort.Tensor("float32", input.decoderState.cLstm, [1, HIDDEN_DIM]),
  };

  const results = await session.run(feeds);

  const probs = Array.from(results.probs.data as Float32Array);
  const hE = results.h_e_out.data as Float32Array;

  return {
    probs,
    nextDecoderState: {
      hLstm: (results.h_lstm_out.data as Float32Array).slice(),
      cLstm: (results.c_lstm_out.data as Float32Array).slice(),
      prevHE: hE.slice(),
      currentEmbedding: new Float32Array(0), // caller fills in via embeddingForNode()
    },
  };
}

/** Extracts the per-node embedding row h_e[node] to use as next step's `current_embedding`. */
export function embeddingForNode(prevHE: Float32Array, node: number): Float32Array {
  return prevHE.slice(node * HIDDEN_DIM, (node + 1) * HIDDEN_DIM);
}

function flatten(matrix: number[][]): Float32Array {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const out = new Float32Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) out[i * cols + j] = matrix[i][j];
  }
  return out;
}

function flattenBool(matrix: boolean[][]): Uint8Array {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const out = new Uint8Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) out[i * cols + j] = matrix[i][j] ? 1 : 0;
  }
  return out;
}

function boolArray(arr: boolean[]): Uint8Array {
  return Uint8Array.from(arr, (v) => (v ? 1 : 0));
}
