// The Campaign is the root entity everything else will eventually hang off of
// (characters, scenes, encounters, codex pages). For the First Milestone only
// this model exists; the rest of the Phase 3 models come later.
export interface Campaign {
  id: string;
  name: string;
  /** Game system label, e.g. "W.T.E". Optional for now. */
  system?: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}
