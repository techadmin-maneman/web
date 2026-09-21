// Vite's ?raw imports, used by the contract test to read committed docs.
declare module "*?raw" {
  const content: string;
  export default content;
}
