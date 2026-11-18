import { categoryOf, epicLinkId, type Issue } from "./jiraModel";

export type IssueLevel = "epic" | "story";

/** These columns describe the visible story. All other columns belong to its epic. */
export function isStoryColumn(ref: string): boolean {
  return ref === "__key" || ref === "jira:summary" || ref === "jira:issuetype" || ref === "stage";
}

export interface StoryBlock {
  issue: Issue;
  rows: Issue[];
}

/** Keep the list's block order and omit a duplicate standalone story already shown inside an epic. */
export function storyBlocks(issues: Issue[], byEpic: Map<string, Issue[]>): StoryBlock[] {
  const expanded = new Set(issues.filter(i => categoryOf(i) === "epic").map(i => i.key));
  return issues.filter(i => categoryOf(i) !== "story" || !expanded.has(String(i.fields[epicLinkId()] ?? "")))
    .map(issue => ({ issue, rows: categoryOf(issue) === "epic" && byEpic.get(issue.key)?.length
      ? byEpic.get(issue.key)! : [issue] }));
}
