import { define } from "../shared/registry/builtin.ts";

// The keys of grab mode, which `hint --grab_move` starts. The mode's own bundle runs them.
define("grab.move", {
  completion: "hidden",
  modes: ["grab"],
  label: "Move the grabbed element",
  intent: "Move the grabbed element a step in a direction. A range input steps its value instead.",
  params: [
    {
      name: "direction",
      type: "enum",
      values: ["left", "down", "up", "right"],
      value_labels: { left: "left", down: "down", up: "up", right: "right" },
      description: { left: "Move left.", down: "Move down.", up: "Move up.", right: "Move right." },
    },
  ],
  bridge: false,
  runs_in: "content",
  repeatable: false,
  bundle: "grab",
});

define("grab.step", {
  completion: "hidden",
  modes: ["grab"],
  label: "Change the grab step",
  intent: "Halve or double the step of a move key. A range keeps its own.",
  params: [
    {
      name: "scale",
      type: "enum",
      values: ["finer", "coarser"],
      value_labels: { finer: "finer", coarser: "coarser" },
      description: { finer: "Halve the step.", coarser: "Double the step." },
    },
  ],
  bridge: false,
  runs_in: "content",
  repeatable: false,
  bundle: "grab",
});

define("grab.drop", {
  completion: "hidden",
  modes: ["grab"],
  label: "Drop the grabbed element",
  intent: "Drop the grabbed element where it is, and leave grab mode.",
  bridge: false,
  runs_in: "content",
  repeatable: false,
  bundle: "grab",
});

define("grab.cancel", {
  completion: "hidden",
  modes: ["grab"],
  label: "Cancel the grab",
  intent: "Leave grab mode. A range input and a draggable element go back to where they began, and a pointer drag is released where it is.",
  bridge: false,
  runs_in: "content",
  repeatable: false,
  bundle: "grab",
});
