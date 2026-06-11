import { buildModel } from "./src/data.js";

const groups = [
  { id: "GroupCompanyId", name: "Company", children: [{ id: "g1" }, { id: "g2" }] },
  { id: "g1", name: "East", children: [{ id: "g1a" }] },
  { id: "g1a", name: "East-Sub", children: [] },
  { id: "g2", name: "West", children: [] }
];
const users = [
  { id: "u1", name: "alice@x.com", firstName: "Alice", lastName: "A", companyGroups: [{ id: "g1a" }], isEmailReportEnabled: true, activeTo: "2050-01-01T00:00:00.000Z" },
  { id: "u2", name: "bob@x.com", firstName: "Bob", lastName: "B", companyGroups: [{ id: "g1" }], isEmailReportEnabled: false, activeTo: "2050-01-01T00:00:00.000Z" },
  { id: "u3", name: "carol@x.com", firstName: "Carol", lastName: "C", companyGroups: [{ id: "g2" }], reportGroups: [{ id: "g1" }], activeTo: "2020-01-01T00:00:00.000Z" },
  { id: "u4", name: "dan@x.com", firstName: "Dan", lastName: "D", companyGroups: [{ id: "g2" }], activeTo: "2050-01-01T00:00:00.000Z" }
];
const templates = [{ id: "t1", name: "Fleet Utilization" }];
const schedules = [
  { id: "s1", destination: "EmailPdf", template: { id: "t1" }, period: "Weekly",
    includeAllChildrenGroups: [{ id: "g1" }],
    individualEmailRecipients: [{ id: "u4" }] },
  { id: "s2", destination: "EmailExcel", name: "Custom Speeding", frequency: "Daily",
    includeDirectChildrenOnlyGroups: [{ id: "GroupCompanyId" }] },
  { id: "s3", destination: "Dashboard", template: { id: "t1" } },
  { id: "s4", destination: "EmailPdf", name: "Empty Report", mysteryProp: 1 }
];

const m = buildModel({ schedules, users, groups, templates });
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };

assert(m.totals.reportCount === 3, "3 emailed reports (dashboard excluded)");
const s1 = m.reports.find(r => r.id === "s1");
assert(s1.name === "Fleet Utilization", "template name resolved");
assert(s1.frequency === "Weekly", "frequency from period");
const ids1 = s1.recipients.map(r => r.userId).sort().join(",");
assert(ids1 === "u1,u2,u3,u4", "g1 expansion: alice(g1a desc), bob(g1), carol(reportGroups g1), dan(individual) -> " + ids1);
assert(s1.recipients.find(r => r.userId === "u4").via.includes("Individual"), "dan via individual");
assert(s1.recipients.find(r => r.userId === "u2").optedOut === true, "bob flagged opted out");
assert(s1.recipients.find(r => r.userId === "u3").archived === true, "carol flagged archived");

const s2 = m.reports.find(r => r.id === "s2");
const ids2 = s2.recipients.map(r => r.userId).sort().join(",");
assert(ids2 === "u2,u3,u4", "direct-children-only of Company: g1(bob via companyGroups, carol via reportGroups) + g2(carol, dan) but NOT alice(g1a) -> " + ids2);

const s4 = m.reports.find(r => r.id === "s4");
assert(s4.recipients.length === 0, "empty report has zero recipients");
assert(m.unknownKeys.includes("mysteryProp"), "diagnostics catches unknown keys");
assert(m.totals.uniqueRecipientCount === 4, "unique recipients = 4");
console.log("DONE");
