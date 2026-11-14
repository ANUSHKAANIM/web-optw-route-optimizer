// Results of the replan-interval / horizon sensitivity test (5 storms per
// setting, neural solver, control-room planner). Means across storms.
export interface SensitivityRow { vans: number; p: number; H: number; replans: number; avgWaitH: number; maxWaitH: number; reassignments: number; avgSolveMs: number; missed: number; sheltered: number }

export const SENSITIVITY_RESULTS: SensitivityRow[] = [
 {
  "vans": 4,
  "p": 0.5,
  "H": 8,
  "replans": 97,
  "avgWaitH": 3.37,
  "maxWaitH": 11.06,
  "reassignments": 104.8,
  "avgSolveMs": 9,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 4,
  "p": 1,
  "H": 8,
  "replans": 49,
  "avgWaitH": 2.62,
  "maxWaitH": 7.6,
  "reassignments": 39.8,
  "avgSolveMs": 10,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 4,
  "p": 2,
  "H": 8,
  "replans": 25,
  "avgWaitH": 2.41,
  "maxWaitH": 7.87,
  "reassignments": 15.4,
  "avgSolveMs": 15,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 4,
  "p": 3,
  "H": 8,
  "replans": 17,
  "avgWaitH": 2.45,
  "maxWaitH": 7.56,
  "reassignments": 6.6,
  "avgSolveMs": 18,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 4,
  "p": 6,
  "H": 6,
  "replans": 9,
  "avgWaitH": 2.3,
  "maxWaitH": 6.88,
  "reassignments": 0,
  "avgSolveMs": 29,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 4,
  "p": 6,
  "H": 8,
  "replans": 9,
  "avgWaitH": 2.33,
  "maxWaitH": 6.26,
  "reassignments": 0.6,
  "avgSolveMs": 31,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 4,
  "p": 6,
  "H": 10,
  "replans": 9,
  "avgWaitH": 2.46,
  "maxWaitH": 6.46,
  "reassignments": 1.8,
  "avgSolveMs": 31,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 4,
  "p": 6,
  "H": 12,
  "replans": 9,
  "avgWaitH": 2.54,
  "maxWaitH": 6.65,
  "reassignments": 2.2,
  "avgSolveMs": 29,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 2,
  "p": 0.5,
  "H": 8,
  "replans": 97,
  "avgWaitH": 8.06,
  "maxWaitH": 22.58,
  "reassignments": 127,
  "avgSolveMs": 12,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 2,
  "p": 1,
  "H": 8,
  "replans": 49,
  "avgWaitH": 5.81,
  "maxWaitH": 16.65,
  "reassignments": 43.8,
  "avgSolveMs": 13,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 2,
  "p": 2,
  "H": 8,
  "replans": 25,
  "avgWaitH": 5.26,
  "maxWaitH": 15.53,
  "reassignments": 13.8,
  "avgSolveMs": 17,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 2,
  "p": 3,
  "H": 8,
  "replans": 17,
  "avgWaitH": 5.21,
  "maxWaitH": 13.37,
  "reassignments": 10.2,
  "avgSolveMs": 19,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 2,
  "p": 6,
  "H": 6,
  "replans": 9,
  "avgWaitH": 5.69,
  "maxWaitH": 13.33,
  "reassignments": 0,
  "avgSolveMs": 25,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 2,
  "p": 6,
  "H": 8,
  "replans": 9,
  "avgWaitH": 5.4,
  "maxWaitH": 15.03,
  "reassignments": 0.8,
  "avgSolveMs": 32,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 2,
  "p": 6,
  "H": 10,
  "replans": 9,
  "avgWaitH": 4.96,
  "maxWaitH": 13.78,
  "reassignments": 2.6,
  "avgSolveMs": 33,
  "missed": 0,
  "sheltered": 100.0
 },
 {
  "vans": 2,
  "p": 6,
  "H": 12,
  "replans": 9,
  "avgWaitH": 4.83,
  "maxWaitH": 13.94,
  "reassignments": 3.4,
  "avgSolveMs": 33,
  "missed": 0,
  "sheltered": 100.0
 }
];
