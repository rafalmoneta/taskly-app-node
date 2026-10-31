import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

export const ReportSchema = Type.Object({
  decision: StringEnum([
    "tests_added",
    "tests_updated",
    "no_tests_needed",
    "needs_human",
  ] as const),
  reason: Type.String({ maxLength: 1000 }),
  changes: Type.Array(
    Type.Object({
      source: Type.String({
        description: "Repo-relative source file analysed",
      }),
      test: Type.Optional(
        Type.String({
          description: "Repo-relative test file created or updated",
        }),
      ),
      action: StringEnum(["created", "updated", "none"] as const),
      why: Type.String({ maxLength: 300 }),
    }),
  ),
  not_covered: Type.Array(
    Type.String({ description: "What was not tested and why" }),
  ),
});

export type Report = Static<typeof ReportSchema>;
