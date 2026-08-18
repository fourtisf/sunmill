/** Shapes of the JSON columns and of the resolved snapshot the client mirrors. */

export type AnimalState = 'hungry' | 'full' | 'ready';

/** Stored in MachineState.jobs. `sec` is REAL seconds (TIME_SCALE already applied
 *  at enqueue time) so retuning TIME_SCALE never re-times a job already running. */
export interface MachineJob {
  out: string;
  sec: number;
  /** ISO timestamp. Only the head of the queue carries one; the rest derive. */
  startedAt: string | null;
}

/** Stored in PenState.animals. */
export interface AnimalSlot {
  state: AnimalState;
  /** ISO timestamp of the last feed, or null when hungry. */
  fedAt: string | null;
}

export interface RawTile {
  index: number;
  crop: string | null;
  plantedAt: Date | null;
}

export interface RawMachine {
  machine: string;
  jobs: MachineJob[];
  done: Record<string, number>;
}

export interface RawPen {
  pen: string;
  animals: AnimalSlot[];
}

/* ── resolved views (what the API returns) ───────────────────────────── */

export interface ResolvedTile {
  index: number;
  crop: string | null;
  plantedAt: string | null;
  /** Real seconds this crop takes, after TIME_SCALE. */
  dur: number;
  ready: boolean;
  /** Present while growing: when it becomes harvestable. */
  readyAt: string | null;
  /** Whether the tile is unlocked at the farm's current level. */
  open: boolean;
}

export interface ResolvedJob extends MachineJob {
  /** Derived start for queued jobs; equals startedAt for the head. */
  startsAt: string;
  endsAt: string;
}

export interface ResolvedMachine {
  machine: string;
  jobs: ResolvedJob[];
  done: Record<string, number>;
  slots: number;
  /** Whether the machine is unlocked at the farm's current level. */
  open: boolean;
}

export interface ResolvedAnimal extends AnimalSlot {
  readyAt: string | null;
}

export interface ResolvedPen {
  pen: string;
  animals: ResolvedAnimal[];
  open: boolean;
}

export interface ResolvedFarm {
  tiles: ResolvedTile[];
  machines: ResolvedMachine[];
  pens: ResolvedPen[];
  /** Machine/pen ids whose stored JSON differs from the resolved state and
   *  should be written back. Empty on a farm with nothing to settle. */
  dirtyMachines: string[];
  dirtyPens: string[];
}
