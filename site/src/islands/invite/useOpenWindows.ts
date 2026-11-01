import { useCallback, useEffect, useState } from "preact/hooks";
import { fetchOpenWindows, type OpenWindows } from "../../lib/api.ts";
import { withoutRefused, type OpenDays } from "../../lib/open-windows.ts";

type Plan = OpenWindows["plan"];

/**
 * The days and windows open for the plan chosen, as the API last answered for it; null until it has. `refresh` asks
 * again past the browser's cache, once booking has found a window full, shutting the start booking was refused at,
 * which the next answer, planned on the estimate of the drives, would offer again.
 */
export function useOpenWindows(pincode: string, plan: Plan) {
  const [answers, setAnswers] = useState<Partial<Record<Plan, OpenDays>>>({});
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(
    async (fresh: boolean) => {
      const answer = await fetchOpenWindows(pincode, plan, fresh);
      if (!answer.ok) return;
      const { body } = answer;
      setAnswers((known) => ({ ...known, [body.plan]: body.days }));
    },
    [pincode, plan],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return {
    days: withoutRefused(answers[plan] ?? null, refused),
    refresh: (refusedAt: string | null = null) => {
      if (refusedAt !== null) setRefused((was) => new Set([...was, refusedAt]));
      return load(true);
    },
  };
}
