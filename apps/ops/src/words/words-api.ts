// Words' calls to mm-api: every line and its history, a wording set, and the site published. Each is the console's
// client's (../api.ts), one function a route, so a call is found, and changed, in one place.

import { client } from "../api.ts";

export const wordsApi = {
  words: () => client.get("/api/words"),
  wordHistory: (key: string) => client.get("/api/words/history", { query: { key } }),
  setWord: (key: string, text: string | null) => client.post("/api/words", { body: { key, text } }),
  publishWords: () => client.post("/api/words/publish"),
};
