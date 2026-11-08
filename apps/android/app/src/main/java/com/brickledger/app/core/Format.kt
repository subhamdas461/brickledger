package com.brickledger.app.core

import android.icu.text.NumberFormat
import android.icu.util.Currency
import android.icu.util.ULocale
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Money formatting with ICU so INR uses lakh grouping (₹12,34,567) like the web app.
 * Mirrors packages/shared/src/format.ts.
 */
object Money {
    private val locales = mapOf(
        "INR" to "en_IN", "USD" to "en_US", "EUR" to "en_IE", "GBP" to "en_GB", "AED" to "en_AE",
        "SAR" to "en_SA", "QAR" to "en_QA", "AUD" to "en_AU", "CAD" to "en_CA", "NZD" to "en_NZ",
        "SGD" to "en_SG", "MYR" to "en_MY", "NPR" to "en_NP", "LKR" to "en_LK", "BDT" to "en_BD",
        "PKR" to "en_PK", "ZAR" to "en_ZA", "NGN" to "en_NG", "KES" to "en_KE", "PHP" to "en_PH",
    )
    val currencies: List<String> = locales.keys.toList()

    private val cache = HashMap<String, NumberFormat>()

    private fun formatter(currency: String, fraction: Boolean): NumberFormat = synchronized(cache) {
        cache.getOrPut("$currency:$fraction") {
            NumberFormat.getCurrencyInstance(ULocale(locales[currency] ?: "en_US")).apply {
                runCatching { this.currency = Currency.getInstance(currency) }
                minimumFractionDigits = if (fraction) 2 else 0
                maximumFractionDigits = if (fraction) 2 else 0
            }
        }
    }

    fun symbol(currency: String): String =
        runCatching { Currency.getInstance(currency).getSymbol(ULocale(locales[currency] ?: "en_US")) }.getOrDefault(currency)

    fun format(amount: Double?, currency: String): String {
        val v = amount ?: 0.0
        val fraction = (v * 100).roundToLong() % 100 != 0L
        return formatter(currency, fraction).format(v)
    }

    /** ₹12.3L / ₹1.25Cr for INR, $12.3K / $1.2M elsewhere. */
    fun compact(amount: Double?, currency: String): String {
        val v = amount ?: 0.0
        val a = abs(v)
        val sign = if (v < 0) "-" else ""
        val sym = symbol(currency)
        fun one(x: Double) = String.format(Locale.US, "%.1f", x).removeSuffix(".0")
        fun two(x: Double) = String.format(Locale.US, "%.2f", x).removeSuffix("0").removeSuffix(".0")
        return when {
            currency == "INR" && a >= 1e7 -> "$sign$sym${two(a / 1e7)}Cr"
            currency == "INR" && a >= 1e5 -> "$sign$sym${one(a / 1e5)}L"
            currency != "INR" && a >= 1e9 -> "$sign$sym${one(a / 1e9)}B"
            currency != "INR" && a >= 1e6 -> "$sign$sym${one(a / 1e6)}M"
            a >= 1e4 && currency != "INR" -> "$sign$sym${one(a / 1e3)}K"
            else -> format(v.roundToLong().toDouble(), currency)
        }
    }
}

object Dates {
    private val full = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
    private val short = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)
    // "Nov '26" - without the apostrophe it reads as the 26th of November.
    private val month = DateTimeFormatter.ofPattern("MMM ''yy", Locale.ENGLISH)
    private val weekday = DateTimeFormatter.ofPattern("EEE, d MMM", Locale.ENGLISH)

    fun format(iso: String?): String = iso?.take(10)?.let { runCatching { LocalDate.parse(it).format(full) }.getOrNull() } ?: ""
    fun short(iso: String?): String = iso?.take(10)?.let { runCatching { LocalDate.parse(it).format(short) }.getOrNull() } ?: ""
    fun weekday(iso: String): String = runCatching { LocalDate.parse(iso).format(weekday) }.getOrDefault(iso)
    fun month(yyyyMm: String): String = runCatching { LocalDate.parse("$yyyyMm-01").format(month) }.getOrDefault(yyyyMm)

    fun relativeDay(iso: String?): String {
        val d = iso?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: return ""
        val today = LocalDate.now()
        return when (d) {
            today -> "Today"
            today.minusDays(1) -> "Yesterday"
            else -> if (d.year == today.year) d.format(short) else d.format(full)
        }
    }
}

fun Double.fmtQty(): String =
    if (this % 1.0 == 0.0) NumberFormat.getIntegerInstance(ULocale("en_IN")).format(this.roundToLong())
    else String.format(Locale.US, "%.2f", this).trimEnd('0').trimEnd('.')

/** Wage for one attendance record; overtime paid at the hourly rate of an 8-hour day. */
fun wageFor(status: String, overtimeHours: Double, dailyWage: Double): Double {
    val base = when (status) {
        "present" -> dailyWage
        "half" -> dailyWage / 2
        else -> 0.0
    }
    return base + overtimeHours * (dailyWage / 8)
}
