// One word of command line text in single quotes. Single quotes are literal, so a quote inside closes, escapes and reopens.
export const single_quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;
