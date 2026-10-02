import { useEffect, useState } from "preact/hooks";
import { fetchOpenWindows, type OpenWindows } from "../../lib/api.ts";
import type { OpenDays } from "../../lib/open-windows.ts";

type Plan = OpenWindows["plan"];

/**
 * The days and windows open for the plan chosen, as the API last answered for it; null until it has. `refresh` asks
 * again past the browser's cache, once booking has found a window full.
 */
export function useOpenWindows(pincode: string, plan: Plan) {
  const [answers, setAnswers] = useState<Partial<Record<Plan, OpenDays>>>({});

  async function load(fresh: boolean) {
    const answer = await fetchOpenWindows(pincode, plan, fresh);
    if (!answer.ok) return;
    const { body } = answer;
    setAnswers((known) => ({ ...known, [body.plan]: body.days }));
  }

  useEffect(() => {
    void load(false);
  }, [pincode, plan]);

  return { days: answers[plan] ?? null, refresh: () => load(true) };
}
