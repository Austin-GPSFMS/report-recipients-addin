import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@geotab/zenith/dist/button/button";
import { Banner } from "@geotab/zenith/dist/banner/banner";
import { Waiting } from "@geotab/zenith/dist/waiting/waiting";
import { EmptyState } from "@geotab/zenith/dist/emptyState/emptyState";
import { loadAll, buildModel } from "./data.js";
import { exportToExcel } from "./excel.js";

function Chip({ kind, children }) {
    return <span className={"rr-chip rr-chip--" + (kind || "default")}>{children}</span>;
}

/** Which hidden-by-default categories a recipient falls into. */
function issueFlags(rec) {
    const flags = [];
    if (rec.archived || rec.unknown) flags.push("archived");
    if (rec.optedOut) flags.push("optedOut");
    if (rec.noEmail) flags.push("noEmail");
    return flags;
}

const MAX_RENDERED_ROWS = 1000;

function RecipientTable({ report }) {
    const rows = report.visibleRecipients.slice(0, MAX_RENDERED_ROWS);
    const truncated = report.visibleRecipients.length - rows.length;
    return (
        <div className="rr-detail">
            {report.groupSources.length > 0 && (
                <div className="rr-sources">
                    <strong>Recipient groups:</strong> {report.groupSources.join(", ")}
                </div>
            )}
            {report.redirectedTo.length > 0 && (
                <Banner type="warning" icon>
                    This report is redirected to: {report.redirectedTo.map(r => r.email || r.name).join(", ")}
                </Banner>
            )}
            {report.visibleRecipients.length === 0 ? (
                <div className="rr-none">
                    {report.hiddenCount > 0
                        ? "All " + report.hiddenCount + " recipient(s) are hidden by the status filters above."
                        : "No individual recipients resolved for this report."}
                </div>
            ) : (
                <table className="rr-table">
                    <thead>
                        <tr>
                            <th>Recipient</th>
                            <th>Email</th>
                            <th>Added via</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(rec => (
                            <tr key={rec.userId}>
                                <td>{rec.name}</td>
                                <td>{rec.noEmail
                                    ? <span className="rr-username" title="Username only — not a deliverable email">{rec.email}</span>
                                    : rec.email}</td>
                                <td className="rr-via">{rec.via.join("; ")}</td>
                                <td>
                                    {rec.unknown && <Chip kind="error">Unknown user</Chip>}
                                    {rec.archived && <Chip kind="error">Archived</Chip>}
                                    {rec.optedOut && <Chip kind="warn">Email reports off</Chip>}
                                    {rec.noEmail && <Chip kind="warn">No email address</Chip>}
                                    {issueFlags(rec).length === 0 && <Chip kind="ok">OK</Chip>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {truncated > 0 && (
                <div className="rr-hiddennote" style={{ marginTop: 8 }}>
                    Showing the first {MAX_RENDERED_ROWS.toLocaleString()} of{" "}
                    {report.visibleRecipients.length.toLocaleString()} recipients — use Export to
                    Excel for the complete list.
                </div>
            )}
        </div>
    );
}

function ReportRow({ report, expanded, onToggle, countLabel }) {
    const broken = report.visibleRecipients.length === 0 && report.hiddenCount === 0;
    return (
        <div className={"rr-report" + (expanded ? " rr-report--open" : "")}>
            <button type="button" className="rr-report__head" onClick={onToggle} aria-expanded={expanded}>
                <span className="rr-caret">{expanded ? "▾" : "▸"}</span>
                <span className="rr-report__name" title={report.name}>{report.name}</span>
                <span className="rr-report__chips">
                    {!report.isActive && <Chip kind="warn">Paused</Chip>}
                    {report.format && <Chip>{report.format}</Chip>}
                    {report.frequency && <Chip>{report.frequency}</Chip>}
                    <Chip kind={broken ? "error" : "count"}>
                        {report.visibleRecipients.length} {countLabel}
                    </Chip>
                    {report.hiddenCount > 0 && <Chip>+{report.hiddenCount} filtered</Chip>}
                </span>
            </button>
            {expanded && <RecipientTable report={report} />}
        </div>
    );
}

export default function App({ api, mode, onClose, focusReportId }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [model, setModel] = useState(null);
    const [database, setDatabase] = useState("");
    const [query, setQuery] = useState("");
    const [expanded, setExpanded] = useState(() => new Set());
    const [showDiag, setShowDiag] = useState(false);
    const [focusOnly, setFocusOnly] = useState(!!focusReportId);
    // Category view selector: a recipient is shown if any of its
    // categories is checked. Default: only "receiving" (OK) recipients.
    const [filters, setFilters] = useState({ ok: true, archived: false, optedOut: false, noEmail: false });

    const toggleFilter = key => setFilters(f => ({ ...f, [key]: !f[key] }));

    // Reports matching the report page the button was clicked from.
    const focusMatches = useMemo(() => {
        if (!model || !focusReportId) return [];
        return model.reports.filter(
            r => r.id === focusReportId || r.templateId === focusReportId
        );
    }, [model, focusReportId]);

    // Auto-expand when focused on a single report.
    useEffect(() => {
        if (focusOnly && focusMatches.length > 0) {
            setExpanded(new Set(focusMatches.map(r => r.id)));
        }
    }, [focusOnly, focusMatches]);

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        loadAll(api)
            .then(raw => {
                setModel(buildModel(raw));
                setLoading(false);
            })
            .catch(err => {
                setError((err && err.message) || String(err));
                setLoading(false);
            });
        try {
            api.getSession(s => setDatabase((s && (s.database || s.path)) || ""), false);
        } catch (e) { /* non-fatal */ }
    }, [api]);

    useEffect(load, [load]);

    // Counts per category across all reports (for the filter labels).
    const filterCounts = useMemo(() => {
        const c = { ok: 0, archived: 0, optedOut: 0, noEmail: 0 };
        if (!model) return c;
        const seen = new Set();
        for (const r of model.reports) {
            for (const rec of r.recipients) {
                if (seen.has(rec.userId)) continue;
                seen.add(rec.userId);
                const flags = issueFlags(rec);
                if (flags.length === 0) c.ok++;
                for (const f of flags) c[f]++;
            }
        }
        return c;
    }, [model]);

    const recVisible = useCallback(rec => {
        const flags = issueFlags(rec);
        if (flags.length === 0) return filters.ok;
        return flags.some(f => filters[f]);
    }, [filters]);

    const filtered = useMemo(() => {
        if (!model) return [];
        const base = focusOnly && focusMatches.length > 0 ? focusMatches : model.reports;
        const q = query.trim().toLowerCase();
        const searched = !q ? base : base.filter(r =>
            r.name.toLowerCase().includes(q) ||
            r.recipients.some(rec =>
                rec.name.toLowerCase().includes(q) ||
                (rec.email || "").toLowerCase().includes(q)
            )
        );
        return searched.map(r => {
            const visibleRecipients = r.recipients.filter(recVisible);
            return {
                ...r,
                visibleRecipients,
                hiddenCount: r.recipients.length - visibleRecipients.length
            };
        });
    }, [model, query, focusOnly, focusMatches, recVisible]);

    const toggle = id => setExpanded(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    // Chip label: "receiving" only when the view is exactly the OK set.
    const countLabel = filters.ok && !filters.archived && !filters.optedOut && !filters.noEmail
        ? "receiving" : "shown";

    const doExport = () => exportToExcel(
        { ...model, reports: filtered.map(r => ({ ...r, recipients: r.visibleRecipients })) },
        database
    );

    return (
        <div className="rr-root zen-deprecated-styles">
            <div className="rr-header">
                <div className="rr-titleblock">
                    <h1 className="rr-title">Report Recipients</h1>
                    {model && (
                        <div className="rr-stats">
                            {model.totals.reportCount} emailed report{model.totals.reportCount === 1 ? "" : "s"}
                            {" · "}
                            {model.totals.receivingCount} unique recipient{model.totals.receivingCount === 1 ? "" : "s"} receiving
                            {model.totals.uniqueRecipientCount > model.totals.receivingCount &&
                                " · " + (model.totals.uniqueRecipientCount - model.totals.receivingCount) + " not receiving (see filters)"}
                        </div>
                    )}
                </div>
                <div className="rr-actions">
                    <Button type="secondary" onClick={load} disabled={loading}>Refresh</Button>
                    <Button
                        type="primary"
                        disabled={loading || !model || model.totals.reportCount === 0}
                        onClick={doExport}
                    >
                        Export to Excel
                    </Button>
                    {mode === "overlay" && (
                        <Button type="tertiary" onClick={onClose} ariaLabel="Close">Close</Button>
                    )}
                </div>
            </div>

            <div className="rr-toolbar">
                <input
                    type="search"
                    className="rr-search"
                    placeholder="Search by report, recipient name, or email…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                />
            </div>

            {!loading && model && (
                <div className="rr-filters">
                    <span className="rr-filters__label">Show:</span>
                    <label>
                        <input type="checkbox" checked={filters.ok} onChange={() => toggleFilter("ok")} />
                        Receiving / OK ({filterCounts.ok})
                    </label>
                    <label>
                        <input type="checkbox" checked={filters.archived} onChange={() => toggleFilter("archived")} />
                        Archived/removed ({filterCounts.archived})
                    </label>
                    <label>
                        <input type="checkbox" checked={filters.optedOut} onChange={() => toggleFilter("optedOut")} />
                        Email reports off ({filterCounts.optedOut})
                    </label>
                    <label>
                        <input type="checkbox" checked={filters.noEmail} onChange={() => toggleFilter("noEmail")} />
                        No email address ({filterCounts.noEmail})
                    </label>
                    <span className="rr-hiddennote">Tick any combination — e.g. only “Email reports off” for an audit.</span>
                </div>
            )}

            {error && (
                <Banner type="error" header="Could not load report schedules" multiline>
                    {error}
                </Banner>
            )}

            {!loading && focusOnly && focusMatches.length > 0 && (
                <div className="rr-focusbar">
                    <span>Showing recipients for this report only.</span>
                    <Button type="tertiary" onClick={() => setFocusOnly(false)}>
                        Show all emailed reports
                    </Button>
                </div>
            )}

            <Waiting isLoading={loading} description="Loading report schedules…" />

            {!loading && !error && model && (
                filtered.length === 0 ? (
                    <EmptyState description={query ? "No reports or recipients match your search." : "No reports are currently set up to be emailed in this database."}>
                        {query ? "No matches" : "No emailed reports"}
                    </EmptyState>
                ) : (
                    <div className="rr-list">
                        {filtered.map(r => (
                            <ReportRow
                                key={r.id}
                                report={r}
                                expanded={expanded.has(r.id)}
                                onToggle={() => toggle(r.id)}
                                countLabel={countLabel}
                            />
                        ))}
                    </div>
                )
            )}

            {!loading && model && model.unknownKeys.length > 0 && (
                <div className="rr-diag">
                    <button type="button" className="rr-diag__toggle" onClick={() => setShowDiag(v => !v)}>
                        Diagnostics
                    </button>
                    {showDiag && (
                        <div className="rr-diag__body">
                            Unrecognized CustomReportSchedule properties (send these to GPSFMS support if
                            recipients look incomplete): {model.unknownKeys.join(", ")}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
