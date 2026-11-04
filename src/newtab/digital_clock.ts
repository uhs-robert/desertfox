// The digital clock: zero-padded hours and minutes in seven-segment digits on a dark chip, as on the GoldenEye bar.
export type ClockFormat = 12 | 24;

export function digital_parts(time: Date, format: ClockFormat): { digits: string; meridiem: string } {
  const hours = format === 24 ? time.getHours() : time.getHours() % 12 || 12;
  const pad = (number: number) => String(number).padStart(2, "0");
  return { digits: `${pad(hours)}:${pad(time.getMinutes())}`, meridiem: format === 24 ? "" : time.getHours() < 12 ? "AM" : "PM" };
}

export function draw_digital_clock(format: ClockFormat): { element: HTMLElement; update(time: Date): void } {
  const element = document.createElement("div");
  element.className = "digital-clock";
  element.setAttribute("role", "img");
  const digits = document.createElement("span");
  digits.className = "digits";
  // The segment font draws every digit with the same shape, so a screen reader needs the plain text from the label.
  digits.setAttribute("aria-hidden", "true");
  const meridiem = document.createElement("span");
  meridiem.className = "meridiem";
  meridiem.setAttribute("aria-hidden", "true");
  element.append(digits, meridiem);
  const update = (time: Date) => {
    const parts = digital_parts(time, format);
    if (digits.textContent === parts.digits && meridiem.textContent === parts.meridiem) return;
    digits.textContent = parts.digits;
    meridiem.textContent = parts.meridiem;
    element.setAttribute("aria-label", `${parts.digits} ${parts.meridiem}`.trim());
  };
  return { element, update };
}
