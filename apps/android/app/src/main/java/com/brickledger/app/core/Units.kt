package com.brickledger.app.core

import kotlin.math.pow
import kotlin.math.roundToLong

/**
 * Units a material can be counted in (same list and factors as packages/shared/src/units.ts). Units in
 * the same family convert, so sand tracked in cft can be shown or entered in m³ or brass. Codes are what's
 * stored; `short` is what people see (cubic metre is stored as `cum` and shown as m³).
 */
object Units {
    data class Unit(val code: String, val short: String, val name: String, val family: String? = null, val inBase: Double = 1.0)

    private const val FT = 0.3048

    val all: List<Unit> = listOf(
        Unit("bags", "bags", "bags"),
        Unit("kg", "kg", "kilogram", "weight", 1.0),
        Unit("qtl", "quintal", "100 kg", "weight", 100.0),
        Unit("ton", "ton", "tonne, 1000 kg", "weight", 1000.0),
        Unit("cft", "cft", "cubic feet", "volume", 1.0),
        Unit("cum", "m³", "cubic metre", "volume", 1 / FT.pow(3)), // 35.3147 cft
        Unit("brass", "brass", "100 cubic feet", "volume", 100.0),
        Unit("nos", "nos", "pieces"),
        Unit("sqft", "sqft", "square feet", "area", 1.0),
        Unit("sqm", "m²", "square metre", "area", 1 / FT.pow(2)), // 10.7639 sqft
        Unit("rft", "rft", "running feet", "length", 1.0),
        Unit("rmt", "rmt", "running metre", "length", 1 / FT), // 3.2808 rft
        Unit("ltr", "ltr", "litres"),
        Unit("trip", "trip", "truck trips"),
        Unit("box", "box", "boxes"),
        Unit("set", "set", "sets"),
    )
    private val byCode = all.associateBy { it.code }

    val familyLabels = mapOf("volume" to "Volumes in", "weight" to "Weights in", "area" to "Areas in", "length" to "Lengths in")

    /** For pickers: code to "m³ · cubic metre". */
    val choices: List<Pair<String, String>> = all.map { it.code to "${it.short} · ${it.name}" }

    fun short(code: String?): String = code?.let { byCode[it]?.short ?: it }.orEmpty()

    fun family(code: String): String? = byCode[code]?.family

    /** Units this one converts into (itself first). */
    fun compatible(code: String): List<String> {
        val family = family(code) ?: return listOf(code)
        return listOf(code) + all.filter { it.family == family && it.code != code }.map { it.code }
    }

    fun inFamily(family: String): List<String> = all.filter { it.family == family }.map { it.code }

    /** The unit to show something recorded in `code` in, given the chosen view per family. */
    fun shown(code: String, view: Map<String, String>): String {
        val chosen = family(code)?.let { view[it] } ?: return code
        return if (chosen in compatible(code)) chosen else code
    }

    /** A quantity in `from` expressed in `to` (unchanged when they don't convert). */
    fun convert(value: Double, from: String, to: String): Double {
        val a = byCode[from]
        val b = byCode[to]
        if (from == to || a?.family == null || a.family != b?.family) return value
        return value * a.inBase / b.inBase
    }

    /** A price per `from` expressed per `to`: ₹50 per cft is ₹1,765.73 per m³. */
    fun convertRate(rate: Double, from: String, to: String): Double = convert(rate, to, from)

    fun round3(v: Double): Double = (v * 1000).roundToLong() / 1000.0
    /** Stock rates keep 4 decimals (as the server stores them), so ₹1,800/m³ comes back as ₹1,800. */
    fun round4(v: Double): Double = (v * 10_000).roundToLong() / 10_000.0
}
