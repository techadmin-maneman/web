// Fills the {name} holes in a content string: fill("not yet in {city}", { city: "Pune" }).

export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (hole, key: string) => values[key] ?? hole);
}
