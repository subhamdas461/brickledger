package com.brickledger.app.core

import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlinx.serialization.json.Json

/** Shared JSON configuration for API and sync payloads. */
val AppJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    coerceInputValues = true
    isLenient = true
}

fun newId(): String = UUID.randomUUID().toString()

fun nowIso(): String = Instant.now().toString()

/** Local calendar date as yyyy-MM-dd. */
fun todayIso(): String = LocalDate.now().toString()

fun isoPlusDays(iso: String, days: Long): String = LocalDate.parse(iso).plusDays(days).toString()
