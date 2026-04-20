import { RRule } from "rrule";

import { TaskActivity } from "@repo/core/types";

type RRuleResult<T extends string | undefined> = T extends string
  ? { rrule: RRule; next: Date }
  : { rrule: null; next: null };
export function getRRule<T extends string | undefined>(
  rule: T,
  baseDate: T extends undefined ? undefined : Date
): RRuleResult<T> {
  const rrule = rule ? getRRuleWithStartDate(rule, baseDate as Date) : null;
  const next = rrule ? rrule.after(baseDate as Date) : null;
  return { rrule, next } as RRuleResult<T>;
}

export function getActivityRRule(activity?: TaskActivity | null) {
  return getRRule(
    activity?.task.recurrence?.rule,
    activity?.task.dueDate.toDate()
  );
}

function getRRuleWithStartDate(rule: string, date: Date) {
  return new RRule({
    ...RRule.parseString(rule),
    dtstart: date,
  });
}
