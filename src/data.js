/**
 * Data layer: loads schedules/users/groups/templates in ONE multiCall and
 * resolves recipients entirely client-side.
 *
 * Why the legacy "Show All Recipients" add-in chokes on large databases:
 * it issues separate user lookups per report schedule (N+1 pattern).
 * On a database with hundreds of emailed reports that is hundreds of
 * sequential round-trips. Here we make 4 fetches total, joined in memory.
 */

const EMAIL_DESTINATIONS = new Set(["EmailExcel", "EmailPdf"]);

// Candidate property names for individually-selected recipients on
// CustomReportSchedule. MyGeotab versions differ; we detect at runtime.
const INDIVIDUAL_KEYS = [
    "individualEmailRecipients",
    "individualRecipients",
    "individualUserRecipients",
    "emailRecipients",
    "userRecipients",
    "users"
];

const REDIRECT_KEYS = ["redirectUsers", "redirectTo", "redirectedUsers"];
const FREQUENCY_KEYS = ["period", "frequency", "refreshPeriod", "reportPeriod"];
const NEXTRUN_KEYS = ["nextRun", "nextRunDate", "nextOccurrence"];

const KNOWN_KEYS = new Set([
    "id", "version", "name", "destination", "template", "isActive", "active",
    "arguments", "groups", "scopeGroups", "includeAllChildrenGroups",
    "includeDirectChildrenOnlyGroups", "lastModifiedUser", "lastRun",
    ...INDIVIDUAL_KEYS, ...REDIRECT_KEYS, ...FREQUENCY_KEYS, ...NEXTRUN_KEYS
]);

/** Promisified api.call / api.multiCall */
export function pCall(api, method, params) {
    return new Promise((resolve, reject) => api.call(method, params, resolve, reject));
}
export function pMultiCall(api, calls) {
    return new Promise((resolve, reject) => api.multiCall(calls, resolve, reject));
}

function getCall(typeName, fields) {
    const call = { typeName, resultsLimit: 50000 };
    if (fields) {
        call.propertySelector = { fields, isIncluded: true };
    }
    return call;
}

/**
 * Load everything in one multiCall. If the server rejects propertySelector
 * (older versions), retry without it.
 */
export async function loadAll(api) {
    const calls = [
        ["Get", getCall("CustomReportSchedule")],
        ["Get", getCall("User", [
            "id", "name", "firstName", "lastName",
            "companyGroups", "reportGroups",
            "isEmailReportEnabled", "activeTo", "isDriver"
        ])],
        ["Get", getCall("Group", ["id", "name", "children", "reference"])],
        ["Get", getCall("ReportTemplate", ["id", "name", "reportTemplateType"])]
    ];
    try {
        const [schedules, users, groups, templates] = await pMultiCall(api, calls);
        return { schedules, users, groups, templates };
    } catch (err) {
        // Fallback: no propertySelector (heavier, but compatible).
        const fallback = calls.map(([m, p]) => {
            const { propertySelector, ...rest } = p;
            return [m, rest];
        });
        const [schedules, users, groups, templates] = await pMultiCall(api, fallback);
        return { schedules, users, groups, templates };
    }
}

/* ------------------------------------------------------------------ */
/* Group hierarchy helpers                                             */
/* ------------------------------------------------------------------ */

export function buildGroupIndex(groups) {
    const byId = new Map();
    for (const g of groups) byId.set(g.id, g);
    return byId;
}

/** group id -> Set of ids including the group and ALL descendants */
export function expandAllChildren(groupId, byId, cache = new Map()) {
    if (cache.has(groupId)) return cache.get(groupId);
    const out = new Set([groupId]);
    cache.set(groupId, out); // set early to guard against cycles
    const g = byId.get(groupId);
    const children = (g && g.children) || [];
    for (const c of children) {
        const cid = typeof c === "string" ? c : c.id;
        if (!cid) continue;
        for (const id of expandAllChildren(cid, byId, cache)) out.add(id);
    }
    return out;
}

/** group id -> Set of ids including the group and its DIRECT children only */
export function expandDirectChildren(groupId, byId) {
    const out = new Set([groupId]);
    const g = byId.get(groupId);
    for (const c of (g && g.children) || []) {
        const cid = typeof c === "string" ? c : c.id;
        if (cid) out.add(cid);
    }
    return out;
}

export function groupName(idOrRef, byId) {
    const id = typeof idOrRef === "string" ? idOrRef : idOrRef && idOrRef.id;
    const g = byId.get(id);
    if (g && g.name) return g.name;
    if (id === "GroupCompanyId") return "Entire Organization";
    return id || "?";
}

/* ------------------------------------------------------------------ */
/* User helpers                                                        */
/* ------------------------------------------------------------------ */

export function displayName(u) {
    const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
    return full || u.name || u.id;
}

export function isArchived(u) {
    if (!u.activeTo) return false;
    const t = new Date(u.activeTo).getTime();
    return Number.isFinite(t) && t < Date.now();
}

function userGroupIds(u) {
    const ids = [];
    for (const key of ["companyGroups", "reportGroups"]) {
        for (const g of u[key] || []) {
            ids.push(typeof g === "string" ? g : g.id);
        }
    }
    return ids;
}

/* ------------------------------------------------------------------ */
/* Recipient resolution                                                */
/* ------------------------------------------------------------------ */

function firstPresent(obj, keys, predicate) {
    for (const k of keys) {
        const v = obj[k];
        if (v === undefined || v === null) continue;
        if (predicate && !predicate(v)) continue;
        return { key: k, value: v };
    }
    return null;
}

function refId(x) {
    return typeof x === "string" ? x : x && x.id;
}

/**
 * Resolve one schedule into a normalized record.
 */
export function resolveSchedule(s, ctx) {
    const { usersById, groupsById, templatesById, allCache } = ctx;

    const name =
        s.name ||
        (s.template && (s.template.name || (templatesById.get(refId(s.template)) || {}).name)) ||
        (s.arguments && s.arguments.reportName) ||
        "(unnamed report)";

    const freq = firstPresent(s, FREQUENCY_KEYS, v => typeof v === "string");
    const nextRun = firstPresent(s, NEXTRUN_KEYS, v => typeof v === "string");
    const active = s.isActive !== false && s.active !== false;

    // userId -> { via: Set }
    const hits = new Map();
    const addHit = (userId, via) => {
        if (!userId) return;
        let h = hits.get(userId);
        if (!h) { h = { via: new Set() }; hits.set(userId, h); }
        h.via.add(via);
    };

    // 1) Individually selected recipients
    const individual = firstPresent(s, INDIVIDUAL_KEYS, v => Array.isArray(v));
    for (const entry of (individual && individual.value) || []) {
        // Entries may be a User reference, or a wrapper holding .user
        const id = refId(entry && entry.user ? entry.user : entry);
        addHit(id, "Individual");
    }

    // 2) Group-based recipients
    const groupSources = [];
    const matchUsersToSet = (idSet, viaLabel) => {
        for (const u of usersById.values()) {
            for (const gid of userGroupIds(u)) {
                if (idSet.has(gid)) { addHit(u.id, viaLabel); break; }
            }
        }
    };

    for (const g of s.includeAllChildrenGroups || []) {
        const gid = refId(g);
        if (!gid) continue;
        const label = "Group: " + groupName(gid, groupsById) + " (incl. sub-groups)";
        groupSources.push(label);
        matchUsersToSet(expandAllChildren(gid, groupsById, allCache), label);
    }
    for (const g of s.includeDirectChildrenOnlyGroups || []) {
        const gid = refId(g);
        if (!gid) continue;
        const label = "Group: " + groupName(gid, groupsById) + " (direct only)";
        groupSources.push(label);
        matchUsersToSet(expandDirectChildren(gid, groupsById), label);
    }
    // Some payloads expose a typed `groups` list instead.
    for (const entry of s.groups || []) {
        if (!entry || typeof entry !== "object") continue;
        const gid = refId(entry.group || entry);
        if (!gid) continue;
        const type = entry.reportScheduleGroupType || entry.groupType || entry.type;
        if (type === "DataScope") continue; // scope, not recipients
        const direct = type === "IncludeDirectChildrenOnly";
        const label = "Group: " + groupName(gid, groupsById) + (direct ? " (direct only)" : " (incl. sub-groups)");
        groupSources.push(label);
        matchUsersToSet(
            direct ? expandDirectChildren(gid, groupsById) : expandAllChildren(gid, groupsById, allCache),
            label
        );
    }

    // 3) Redirect
    const redirect = firstPresent(s, REDIRECT_KEYS, v => Array.isArray(v) && v.length > 0);
    const redirectedTo = ((redirect && redirect.value) || []).map(r => {
        const u = usersById.get(refId(r && r.user ? r.user : r));
        return u ? { name: displayName(u), email: u.name } : { name: String(refId(r)), email: "" };
    });

    const recipients = [...hits.entries()].map(([userId, h]) => {
        const u = usersById.get(userId);
        if (!u) return { userId, name: userId, email: "", via: [...h.via], unknown: true };
        return {
            userId,
            name: displayName(u),
            email: u.name, // MyGeotab usernames are email addresses
            via: [...h.via],
            optedOut: u.isEmailReportEnabled === false,
            archived: isArchived(u),
            noEmail: (u.name || "").indexOf("@") === -1
        };
    }).sort((a, b) => a.name.localeCompare(b.name));

    return {
        id: s.id,
        templateId: refId(s.template) || null,
        name,
        format: s.destination === "EmailPdf" ? "PDF" : s.destination === "EmailExcel" ? "Excel" : (s.destination || ""),
        frequency: freq ? String(freq.value) : "",
        nextRun: nextRun ? String(nextRun.value) : "",
        isActive: active,
        groupSources,
        recipients,
        redirectedTo,
        unknownKeys: Object.keys(s).filter(k => !KNOWN_KEYS.has(k))
    };
}

/** Top-level: turn raw API payloads into render-ready model. */
export function buildModel({ schedules, users, groups, templates }) {
    const usersById = new Map(users.map(u => [u.id, u]));
    const groupsById = buildGroupIndex(groups);
    const templatesById = new Map((templates || []).map(t => [t.id, t]));
    const allCache = new Map();
    const ctx = { usersById, groupsById, templatesById, allCache };

    const emailed = (schedules || []).filter(s => EMAIL_DESTINATIONS.has(s.destination));
    const reports = emailed
        .map(s => resolveSchedule(s, ctx))
        .sort((a, b) => a.name.localeCompare(b.name));

    const uniqueRecipients = new Set();
    const receivingRecipients = new Set();
    for (const r of reports) {
        for (const rec of r.recipients) {
            uniqueRecipients.add(rec.userId);
            if (!rec.unknown && !rec.archived && !rec.optedOut && !rec.noEmail) {
                receivingRecipients.add(rec.userId);
            }
        }
    }

    const unknownKeys = [...new Set(reports.flatMap(r => r.unknownKeys))];

    return {
        reports,
        totals: {
            reportCount: reports.length,
            uniqueRecipientCount: uniqueRecipients.size,
            receivingCount: receivingRecipients.size,
            scheduleCount: (schedules || []).length
        },
        unknownKeys
    };
}
