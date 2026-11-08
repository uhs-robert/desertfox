// The toolbar icon for the off state: the same drawing with every fill turned into the grey of equal lightness.

const grey_of = (hex) => {
  const [red, green, blue] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  const level = Math.round(0.299 * red + 0.587 * green + 0.114 * blue)
    .toString(16)
    .padStart(2, "0");
  return `#${level}${level}${level}`;
};

export const grey_svg = (svg) => svg.replace(/fill="(#[0-9a-fA-F]{6})"/g, (_, hex) => `fill="${grey_of(hex)}"`);
