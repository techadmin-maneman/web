// The API's clock, read again twice a minute, for a line that counts down in minutes while the screen stays open.

import { useEffect, useState } from "react";
import { apiDate } from "./when.ts";

const EVERY_MS = 30_000;

export function useMinute(): Date {
  const [now, setNow] = useState(apiDate);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(apiDate());
    }, EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
