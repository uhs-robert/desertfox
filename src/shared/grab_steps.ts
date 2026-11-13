// The pixel steps a grab moves by: the start value (`grab_step_px`) and the doubling and halving of `[` and `]` stay on this one ladder.
export const MIN_GRAB_STEP_PX = 3;
export const MAX_GRAB_STEP_PX = 192;
export const GRAB_STEPS_PX = [3, 6, 12, 24, 48, 96, 192] as const;
