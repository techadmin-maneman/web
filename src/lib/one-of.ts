// Whether a value is one of a fixed list's members, and so of the list's own type.

export const isOneOf = <T>(list: readonly T[], value: unknown): value is T => list.some((member) => member === value);
