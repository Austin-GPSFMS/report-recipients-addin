import ExcelJS from "exceljs/dist/exceljs.min.js";

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00295A" } }; // Geotab dark blue
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
const ZEBRA_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6F9" } };
const BORDER = {
    top: { style: "thin", color: { argb: "FFD0D7E2" } },
    bottom: { style: "thin", color: { argb: "FFD0D7E2" } },
    left: { style: "thin", color: { argb: "FFD0D7E2" } },
    right: { style: "thin", color: { argb: "FFD0D7E2" } }
};

function styleHeader(row) {
    row.eachCell(c => {
        c.fill = HEADER_FILL;
        c.font = HEADER_FONT;
        c.border = BORDER;
        c.alignment = { vertical: "middle" };
    });
    row.height = 20;
}

function addTableSheet(wb, name, columns, rows) {
    const ws = wb.addWorksheet(name, {
        views: [{ state: "frozen", ySplit: 1 }]
    });
    ws.columns = columns;
    styleHeader(ws.getRow(1));
    for (const r of rows) ws.addRow(r);
    ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length }
    };
    for (let i = 2; i <= rows.length + 1; i++) {
        const row = ws.getRow(i);
        row.eachCell({ includeEmpty: true }, c => {
            c.border = BORDER;
            if (i % 2 === 0) c.fill = ZEBRA_FILL;
        });
    }
    return ws;
}

function recipientStatus(rec) {
    const flags = [];
    if (rec.unknown) flags.push("Unknown user");
    if (rec.archived) flags.push("Archived");
    if (rec.optedOut) flags.push("Email reports off");
    return flags.length ? flags.join(", ") : "OK";
}

/** Build the workbook and trigger a browser download. */
export async function exportToExcel(model, databaseName) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Report Recipients add-in (GPSFMS)";
    wb.created = new Date();

    // Sheet 1: one row per (report, recipient)
    const detailRows = [];
    for (const rep of model.reports) {
        if (rep.recipients.length === 0) {
            detailRows.push([rep.name, rep.format, rep.frequency, rep.isActive ? "Active" : "Paused", "(no recipients)", "", "", ""]);
            continue;
        }
        for (const rec of rep.recipients) {
            detailRows.push([
                rep.name,
                rep.format,
                rep.frequency,
                rep.isActive ? "Active" : "Paused",
                rec.name,
                rec.email,
                rec.via.join("; "),
                recipientStatus(rec)
            ]);
        }
    }
    addTableSheet(wb, "Recipients", [
        { header: "Report", key: "report", width: 42 },
        { header: "Format", key: "format", width: 10 },
        { header: "Frequency", key: "freq", width: 14 },
        { header: "Schedule", key: "sched", width: 10 },
        { header: "Recipient", key: "rcpt", width: 28 },
        { header: "Email", key: "email", width: 36 },
        { header: "Added Via", key: "via", width: 40 },
        { header: "Status", key: "status", width: 22 }
    ], detailRows);

    // Sheet 2: per-report summary
    const summaryRows = model.reports.map(rep => [
        rep.name,
        rep.format,
        rep.frequency,
        rep.isActive ? "Active" : "Paused",
        rep.recipients.length,
        rep.groupSources.join("; "),
        rep.redirectedTo.map(r => r.email || r.name).join("; ")
    ]);
    addTableSheet(wb, "Reports Summary", [
        { header: "Report", key: "report", width: 42 },
        { header: "Format", key: "format", width: 10 },
        { header: "Frequency", key: "freq", width: 14 },
        { header: "Schedule", key: "sched", width: 10 },
        { header: "# Recipients", key: "count", width: 14 },
        { header: "Recipient Groups", key: "groups", width: 50 },
        { header: "Redirected To", key: "redir", width: 36 }
    ], summaryRows);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Report Recipients - ${databaseName || "MyGeotab"} - ${stamp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
    }, 1000);
}
