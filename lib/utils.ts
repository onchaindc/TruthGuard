export function cn(...classes: Array<string | false | null | undefined>) { return classes.filter(Boolean).join(" "); }
export function truncateMiddle(value: string, left = 6, right = 4) { return value.length <= left + right + 3 ? value : `${value.slice(0, left)}...${value.slice(-right)}`; }
