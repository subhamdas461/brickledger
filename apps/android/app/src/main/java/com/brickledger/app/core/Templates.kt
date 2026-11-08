package com.brickledger.app.core

import java.time.LocalDate
import kotlin.math.roundToLong

/**
 * Starter data for projects created on the phone (offline mode).
 * Mirrors packages/shared/src/templates.ts so local and cloud projects look the same.
 */
object Templates {
    data class Cat(val name: String, val share: Int, val icon: String)
    data class Ph(val name: String, val weight: Int)
    data class Mat(val name: String, val unit: String, val category: String)

    val categories = listOf(
        Cat("Permits & approvals", 3, "stamp"),
        Cat("Design & consultancy", 4, "ruler"),
        Cat("Excavation & foundation", 9, "shovel"),
        Cat("RCC structure", 18, "columns"),
        Cat("Masonry & plaster", 9, "brick"),
        Cat(LABOUR_CATEGORY, 12, "hardhat"),
        Cat("Roofing & waterproofing", 3, "roof"),
        Cat("Doors & windows", 7, "door"),
        Cat("Electrical", 6, "bolt"),
        Cat("Plumbing & sanitary", 6, "droplet"),
        Cat("Flooring & tiling", 9, "grid"),
        Cat("Painting & finishing", 5, "paint"),
        Cat("Fixtures & fittings", 5, "lamp"),
        Cat("Miscellaneous & contingency", 4, "box"),
    )

    val phases = listOf(
        Ph("Planning & approvals", 6),
        Ph("Site preparation & excavation", 3),
        Ph("Foundation", 7),
        Ph("Plinth & DPC", 3),
        Ph("Superstructure (columns, beams, slabs)", 14),
        Ph("Brickwork / masonry", 8),
        Ph("Roofing & waterproofing", 4),
        Ph("Electrical & plumbing rough-in", 5),
        Ph("Plastering", 6),
        Ph("Flooring & tiling", 6),
        Ph("Doors, windows & carpentry", 6),
        Ph("Painting", 5),
        Ph("Fixtures, fittings & finishing", 5),
        Ph("Handover & snagging", 2),
    )

    val materials = listOf(
        Mat("Cement (OPC/PPC)", "bags", "cement"),
        Mat("TMT steel bars", "kg", "steel"),
        Mat("Sand (M-sand / river)", "cft", "sand"),
        Mat("Aggregate 20mm", "cft", "aggregate"),
        Mat("Bricks / blocks", "nos", "bricks_blocks"),
    )

    /** Budget per category by template share; the last category absorbs rounding. */
    fun splitBudget(budget: Double): List<Double> {
        val step = if (budget >= 100_000) 100.0 else 1.0
        val amounts = categories.map { ((budget * it.share / 100.0) / step).roundToLong() * step }.toMutableList()
        val diff = budget - amounts.sum()
        amounts[amounts.lastIndex] = (amounts.last() + diff).coerceAtLeast(0.0)
        return amounts
    }

    /** Spreads [start, end] across phases proportionally to their weights. */
    fun spreadPhaseDates(start: String?, end: String?): List<Pair<String?, String?>> {
        val s = start?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        val e = end?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        if (s == null || e == null || !e.isAfter(s)) return phases.map { null to null }
        val totalDays = e.toEpochDay() - s.toEpochDay()
        val totalWeight = phases.sumOf { it.weight }
        var cursor = 0L
        return phases.mapIndexed { i, p ->
            val span = if (i == phases.lastIndex) totalDays - cursor else maxOf(1L, Math.round(p.weight.toDouble() / totalWeight * totalDays))
            val from = cursor
            val to = minOf(totalDays, cursor + span)
            cursor = to
            s.plusDays(from).toString() to s.plusDays(to).toString()
        }
    }
}
