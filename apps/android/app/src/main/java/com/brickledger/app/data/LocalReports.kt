package com.brickledger.app.data

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import com.brickledger.app.core.Dates
import com.brickledger.app.core.Money
import com.brickledger.app.core.Vocab
import com.brickledger.app.core.fmtQty
import com.brickledger.app.core.todayIso
import com.brickledger.app.data.local.ProjectEntity
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

/**
 * Reports generated on the phone (no server needed): an A4 PDF in the same layout as the
 * server report, and CSV exports. Used for offline-mode projects and as an offline fallback.
 */
class LocalReports(private val context: Context, private val repo: Repository) {
    private val db get() = repo.db

    private fun outFile(name: String) = File(File(context.cacheDir, "exports").apply { mkdirs() }, name)

    private fun slug(p: ProjectEntity) = p.name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(40).ifEmpty { "project" }

    suspend fun pdf(p: ProjectEntity): File = withContext(Dispatchers.Default) {
        val dash = repo.dashboard(p.id).first() ?: error("No data")
        val vendors = repo.vendorLines(p.id).first()
        val stock = repo.stockLines(p.id).first()
        val labour = repo.labourLines(p.id).first()
        val money = { v: Double? -> if (v == null) "-" else Money.format(Math.round(v).toDouble(), p.currency) }

        val doc = PdfDocument()
        val pageW = 595f
        val pageH = 842f
        val left = 40f
        val width = pageW - 2 * left
        val bottom = pageH - 56f
        var pageNo = 0
        lateinit var page: PdfDocument.Page
        lateinit var c: Canvas
        var y = 0f

        val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(11, 11, 11); textSize = 9f }
        val muted = Paint(ink).apply { color = Color.rgb(137, 135, 129); textSize = 8f }
        val bold = Paint(ink).apply { typeface = Typeface.DEFAULT_BOLD }
        val hairline = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(225, 224, 217); strokeWidth = 0.6f; style = Paint.Style.STROKE }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)

        fun footer() {
            c.drawText("Generated with BrickLedger on this phone · ${p.name}", left, pageH - 28f, muted)
            val label = "Page $pageNo"
            c.drawText(label, pageW - left - muted.measureText(label), pageH - 28f, muted)
        }
        fun newPage() {
            if (pageNo > 0) { footer(); doc.finishPage(page) }
            pageNo++
            page = doc.startPage(PdfDocument.PageInfo.Builder(pageW.toInt(), pageH.toInt(), pageNo).create())
            c = page.canvas
            y = 40f
        }
        fun ensure(h: Float) { if (y + h > bottom) newPage() }
        fun rightText(text: String, xRight: Float, yy: Float, paint: Paint) = c.drawText(text, xRight - paint.measureText(text), yy, paint)
        fun ellipsize(text: String, maxW: Float, paint: Paint): String {
            if (paint.measureText(text) <= maxW) return text
            var t = text
            while (t.isNotEmpty() && paint.measureText("$t…") > maxW) t = t.dropLast(1)
            return "$t…"
        }

        newPage()
        // Header
        c.drawText("BrickLedger", left, y, Paint(bold).apply { color = Color.rgb(194, 65, 12); textSize = 10f })
        y += 24f
        c.drawText(ellipsize(p.name, width, Paint(bold).apply { textSize = 18f }), left, y, Paint(bold).apply { textSize = 18f })
        y += 16f
        c.drawText(listOfNotNull(listOfNotNull(p.address, p.city).joinToString(", ").ifEmpty { null }, "Cost report as of ${Dates.format(todayIso())}", "Currency ${p.currency}").joinToString("  ·  "), left, y, muted)
        y += 18f

        // KPI tiles
        val tiles = listOf(
            "Budget" to money(dash.budget),
            "Committed (paid + due)" to money(dash.committed),
            "Remaining" to money(dash.remaining),
            "Paid so far" to money(dash.paid),
            "Bills due" to money(dash.due),
            "Funds received" to money(dash.fundsReceived),
        )
        val tileW = (width - 16f) / 3
        tiles.forEachIndexed { i, (label, value) ->
            val x = left + (i % 3) * (tileW + 8f)
            val ty = y + (i / 3) * 52f
            c.drawRoundRect(RectF(x, ty, x + tileW, ty + 44f), 6f, 6f, hairline)
            c.drawText(label, x + 8f, ty + 14f, muted)
            c.drawText(value, x + 8f, ty + 33f, Paint(bold).apply { textSize = 13f })
        }
        y += 108f
        c.drawText("Progress ${dash.progress}%" + (dash.costPerArea?.let { "  ·  ${money(it)} per ${if (p.areaUnit == "sqm") "sq m" else "sq ft"}" } ?: "") + "  ·  Cash in hand ${money(dash.cashInHand)}", left, y, muted)
        y += 22f

        fun section(title: String) {
            ensure(60f)
            c.drawText(title, left, y, Paint(bold).apply { textSize = 12f })
            y += 16f
        }
        data class Col(val label: String, val w: Float, val right: Boolean = false)
        fun table(cols: List<Col>, rows: List<List<String>>, meters: List<Pair<Double, Double>?> = emptyList()) {
            val total = cols.sumOf { it.w.toDouble() }.toFloat()
            val scale = width / total
            fun header() {
                var x = left
                cols.forEach { col ->
                    val w = col.w * scale
                    if (col.right) rightText(col.label.uppercase(), x + w - 2f, y, muted) else c.drawText(col.label.uppercase(), x + 2f, y, muted)
                    x += w
                }
                y += 6f
                c.drawLine(left, y, left + width, y, hairline)
                y += 12f
            }
            header()
            rows.forEachIndexed { r, row ->
                val meter = meters.getOrNull(r)
                val rowH = if (meter != null) 22f else 15f
                if (y + rowH > bottom) { newPage(); header() }
                var x = left
                row.forEachIndexed { i, cell ->
                    val w = cols[i].w * scale
                    val text = ellipsize(cell, w - 4f, ink)
                    if (cols[i].right) rightText(text, x + w - 2f, y, ink) else c.drawText(text, x + 2f, y, ink)
                    x += w
                }
                if (meter != null) {
                    val (value, max) = meter
                    val mw = cols[0].w * scale - 8f
                    val ratio = if (max > 0) value / max else 0.0
                    fill.color = Color.rgb(220, 235, 252)
                    c.drawRoundRect(RectF(left + 2f, y + 5f, left + 2f + mw, y + 9f), 2f, 2f, fill)
                    if (value > 0) { // nothing spent = empty track; tiny amounts keep a visible sliver
                        fill.color = if (ratio > 1.0001) Color.rgb(208, 59, 59) else Color.rgb(42, 120, 214)
                        c.drawRoundRect(RectF(left + 2f, y + 5f, left + 2f + (mw * ratio.coerceIn(0.02, 1.0)).toFloat(), y + 9f), 2f, 2f, fill)
                    }
                }
                y += rowH - 3f
                c.drawLine(left, y, left + width, y, hairline)
                y += 12f
            }
            y += 8f
        }

        section("Budget vs actual by category")
        val cats = dash.categories
        table(
            listOf(Col("Category", 190f), Col("Planned", 80f, true), Col("Paid", 80f, true), Col("Due", 70f, true), Col("Used", 50f, true)),
            cats.map { listOf(it.name, money(it.planned), money(it.paid), if (it.due > 0) money(it.due) else "-", if (it.planned > 0) "${(it.committed / it.planned * 100).toInt()}%" else "-") },
            cats.map { if (it.planned > 0) it.committed to it.planned else null },
        )
        if (vendors.isNotEmpty()) {
            section("Vendors & contractors")
            table(
                listOf(Col("Vendor", 200f), Col("Contract", 80f, true), Col("Paid", 80f, true), Col("Due", 70f, true), Col("Balance", 80f, true)),
                vendors.map { listOf(it.vendor.name, money(it.vendor.contractAmount), money(it.paid), if (it.due > 0) money(it.due) else "-", money(it.balance)) },
            )
        }
        if (stock.isNotEmpty()) {
            section("Materials & stock")
            table(
                listOf(Col("Material", 180f), Col("Received", 75f, true), Col("Used", 75f, true), Col("In stock", 75f, true), Col("Value", 85f, true)),
                stock.map { listOf("${it.material.name} (${it.material.unit})", it.received.fmtQty(), it.used.fmtQty(), it.stock.fmtQty(), money(it.value)) },
            )
        }
        if (labour.isNotEmpty()) {
            section("Labour")
            table(
                listOf(Col("Worker", 140f), Col("Trade", 80f), Col("Days", 50f, true), Col("Earned", 80f, true), Col("Paid", 80f, true), Col("Balance", 80f, true)),
                labour.map { listOf(it.worker.name, Vocab.label(Vocab.trades, it.worker.trade), it.days.fmtQty(), money(it.earned), money(it.paid), money(it.balance)) },
            )
        }
        val funds = db.funds().observe(p.id).first().groupBy { it.source }.map { (s, l) -> s to l.sumOf { it.amount } }.sortedByDescending { it.second }
        if (funds.isNotEmpty()) {
            section("Funding")
            table(
                listOf(Col("Source", 300f), Col("Amount", 120f, true)),
                funds.map { listOf(Vocab.label(Vocab.fundSources, it.first), money(it.second)) } + listOf(listOf("Total received", money(dash.fundsReceived))),
            )
        }
        footer()
        doc.finishPage(page)
        val out = outFile("${slug(p)}-report-${todayIso()}.pdf")
        out.outputStream().use { doc.writeTo(it) }
        doc.close()
        out
    }

    suspend fun csv(p: ProjectEntity, kind: String): File = withContext(Dispatchers.IO) {
        val (header, rows) = when (kind) {
            "budget" -> listOf("Category", "Planned", "Paid", "Due", "Remaining") to
                repo.categoryLines(p.id).first().map { listOf(it.name, it.planned, it.paid, it.due, it.planned - it.committed) }
            "vendors" -> listOf("Vendor", "Type", "Phone", "Contract", "Paid", "Due", "Balance") to
                repo.vendorLines(p.id).first().map { listOf(it.vendor.name, Vocab.label(Vocab.vendorTypes, it.vendor.type), it.vendor.phone, it.vendor.contractAmount, it.paid, it.due, it.balance) }
            "materials" -> listOf("Material", "Unit", "Received", "Used", "In stock", "Value") to
                repo.stockLines(p.id).first().map { listOf(it.material.name, it.material.unit, it.received, it.used, it.stock, it.value) }
            "labour" -> listOf("Worker", "Trade", "Daily wage", "Present", "Half days", "OT hours", "Earned", "Paid", "Balance") to
                repo.labourLines(p.id).first().map { listOf(it.worker.name, Vocab.label(Vocab.trades, it.worker.trade), it.worker.dailyWage, it.present, it.half, it.overtime, it.earned, it.paid, it.balance) }
            else -> {
                val cats = db.categories().observe(p.id).first().associate { it.id to it.name }
                val vendors = db.vendors().observe(p.id).first().associate { it.id to it.name }
                listOf("Date", "Title", "Category", "Vendor", "Amount", "Status", "Due date", "Payment mode", "Reference", "Quantity", "Unit", "Rate", "Notes") to
                    db.expenses().observe(p.id).first().map {
                        listOf(it.date, it.title, cats[it.categoryId], vendors[it.vendorId], it.amount, Vocab.label(Vocab.expenseStatus, it.status), it.dueDate,
                            Vocab.label(Vocab.paymentModes, it.paymentMode), it.reference, it.quantity, it.unit, it.rate, it.notes)
                    }
            }
        }
        fun cell(v: Any?): String {
            if (v == null) return ""
            var s = if (v is Double) (if (v % 1.0 == 0.0) v.toLong().toString() else String.format(java.util.Locale.US, "%.2f", v)) else v.toString()
            if (s.isNotEmpty() && s[0] in "=+-@" && v !is Number) s = "'$s" // spreadsheet formula injection guard
            return if (s.any { it == ',' || it == '"' || it == '\n' }) "\"${s.replace("\"", "\"\"")}\"" else s
        }
        val out = outFile("${slug(p)}-${if (kind == "expenses" || kind.isBlank()) "expenses" else kind}.csv")
        out.writeText("﻿" + (listOf(header) + rows).joinToString("\r\n") { r -> r.joinToString(",") { cell(it) } } + "\r\n")
        out
    }
}
