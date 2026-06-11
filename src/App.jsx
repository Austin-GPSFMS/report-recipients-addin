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

function RecipientTable({ report }) {
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
            {report.recipients.length === 0 ? (
                <div className="rr-none">No individual recipients resolved for this report.</div>
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
                        {report.recipients.map(rec => (
                            <tr key={rec.userId}>
                                <td>{rec.name}</td>
                                <td>{rec.email}</td>
                                <td className="rr-via">{rec.via.join("; ")}</td>
                                <td>
                                    {rec.unknown && <Chip kind="error">Unknown user</Chip>}
                                    {rec.archived && <Chip kind="error">Archived</Chip>}
                                    {rec.optedOut && <Chip kind="warn">Email reports off</Chip>}
                                    {!rec.unknown && !rec.archived && !rec.optedOut && <Chip kind="ok">OK</Chip>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function ReportRow({ report, expanded, onToggle }) {
    const broken = report.recipients.length === 0;
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
                        {report.recipients.length} recipient{report.recipients.length === 1 ? "" : "s"}
                    </Chip>
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

    const filtered = useMemo(() => {
        if (!model) return [];
        const base = focusOnly && focusMatches.length > 0 ? focusMatches : model.reports;
        const q = query.trim().toLowerCase();
        if (!q) return base;
        return base.filter(r =>
            r.name.toLowerCase().includes(q) ||
            r.recipients.some(rec =>
                rec.name.toLowerCase().includes(q) ||
                (rec.email || "").toLowerCase().includes(q)
            )
        );
    }, [model, query, focusOnly, focusMatches]);

    const toggle = id => setExpanded(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    const expandAll = () => setExpanded(new Set(filtered.map(r => r.id)));
    const collapseAll = () => setExpanded(new Set());

    return (
        <div className="rr-root zen-deprecated-styles">
            <div className="rr-header">
                <div className="rr-titleblock">
                    <h1 className="rr-title">Report Recipients</h1>
                    {model && (
                        <div className="rr-stats">
                            {model.totals.reportCount} emailed report{model.totals.reportCount === 1 ? "" : "s"}
                            {" · "}
                            {model.totals.uniqueRecipientCount} unique recipient{model.totals.uniqueRecipientCount === 1 ? "" : "s"}
                        </div>
                    )}
                </div>
                <div className="rr-actions">
                    <Button type="secondary" onClick={load} disabled={loading}>Refresh</Button>
                    <Button
                        type="primary"
                        disabled={loading || !model || model.totals.reportCount === 0}
                        onClick={() => exportToExcel({ ...model, reports: filtered }, database)}
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
                <Button type="tertiary" onClick={expandAll} disabled={loading}>Expand all</Button>
                <Button type="tertiary" onClick={collapseAll} disabled={loading}>Collapse all</Button>
            </div>

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
