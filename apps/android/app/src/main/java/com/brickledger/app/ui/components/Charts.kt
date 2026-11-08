package com.brickledger.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.brickledger.app.ui.theme.LocalChartColors
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.min
import kotlin.math.pow

data class Segment(val label: String, val value: Double, val color: Color, val darkText: Boolean = false)

/**
 * Tall segmented bar: one whole split into <= 6 parts with 2dp gaps, share printed
 * inside only when it fits, legend below in block order. Tap a block for its value.
 */
@Composable
fun SegmentedBar(parts: List<Segment>, total: Double, format: (Double) -> String, modifier: Modifier = Modifier) {
    val visible = parts.filter { it.value > 0 }
    var selected by remember { mutableStateOf<Int?>(null) }
    val measurer = rememberTextMeasurer()
    val c = LocalChartColors.current
    Column(modifier) {
        BoxWithConstraints(Modifier.fillMaxWidth().height(28.dp)) {
            val widthPx = constraints.maxWidth.toFloat()
            Canvas(
                Modifier
                    .fillMaxWidth()
                    .height(28.dp)
                    .semantics { contentDescription = visible.joinToString { "${it.label} ${format(it.value)}" } }
                    .pointerInput(visible, total) {
                        detectTapGestures { pos ->
                            var x = 0f
                            val gap = 2.dp.toPx()
                            val usable = widthPx - gap * (visible.size - 1).coerceAtLeast(0)
                            visible.forEachIndexed { i, p ->
                                val w = (usable * (p.value / total)).toFloat()
                                if (pos.x in x..(x + w)) selected = if (selected == i) null else i
                                x += w + gap
                            }
                        }
                    },
            ) {
                if (total <= 0 || visible.isEmpty()) {
                    drawRoundRect(c.track, cornerRadius = androidx.compose.ui.geometry.CornerRadius(4.dp.toPx()))
                    return@Canvas
                }
                val gap = 2.dp.toPx()
                val usable = size.width - gap * (visible.size - 1)
                var x = 0f
                visible.forEachIndexed { i, p ->
                    val w = (usable * (p.value / total)).toFloat().coerceAtLeast(0f)
                    drawRoundRect(
                        color = if (selected == null || selected == i) p.color else p.color.copy(alpha = 0.55f),
                        topLeft = Offset(x, 0f),
                        size = Size(w, size.height),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(4.dp.toPx()),
                    )
                    val text = "${((p.value / total) * 100).toInt()}%"
                    val layout = measurer.measure(text, TextStyle(fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = if (p.darkText) Color(0xFF0B0B0B) else Color.White))
                    if (layout.size.width + 12.dp.toPx() < w) {
                        drawText(layout, topLeft = Offset(x + 6.dp.toPx(), (size.height - layout.size.height) / 2))
                    }
                    x += w + gap
                }
            }
        }
        selected?.let { i ->
            visible.getOrNull(i)?.let { p ->
                Text(
                    "${format(p.value)} · ${p.label} · ${((p.value / total) * 100).toInt()}%",
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.height(20.dp),
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            visible.forEach { p ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(p.color))
                    Spacer(Modifier.width(6.dp))
                    Text(p.label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

private fun niceStep(raw: Double): Double {
    if (raw <= 0) return 1.0
    val pow = 10.0.pow(floor(log10(raw)))
    val n = raw / pow
    return (if (n <= 1) 1.0 else if (n <= 2) 2.0 else if (n <= 2.5) 2.5 else if (n <= 5) 5.0 else 10.0) * pow
}

/**
 * Single-series column chart: hairline solid grid, compact ticks, bars <= 24dp with a
 * 4dp rounded data end and square baseline. Tap a column to read its value.
 */
@Composable
fun ColumnChart(points: List<Pair<String, Double>>, format: (Double) -> String, formatTick: (Double) -> String, modifier: Modifier = Modifier) {
    val c = LocalChartColors.current
    val measurer = rememberTextMeasurer()
    var selected by remember(points) { mutableStateOf<Int?>(points.indexOfLast { it.second > 0 }.takeIf { it >= 0 }) }
    val labelStyle = TextStyle(fontSize = 10.sp, color = c.muted)
    Column(modifier) {
        val sel = selected?.let { points.getOrNull(it) }
        Row(verticalAlignment = Alignment.Bottom) {
            Text(sel?.let { format(it.second) } ?: " ", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.width(6.dp))
            Text(sel?.first ?: "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(8.dp))
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(180.dp)
                .semantics { contentDescription = points.joinToString { "${it.first} ${format(it.second)}" } }
                .pointerInput(points) {
                    detectTapGestures { pos ->
                        val axis = 40.dp.toPx()
                        val band = (size.width - axis) / points.size.coerceAtLeast(1)
                        val i = ((pos.x - axis) / band).toInt()
                        if (i in points.indices) selected = i
                    }
                },
        ) {
            val axis = 40.dp.toPx()
            val bottom = 20.dp.toPx()
            val plotH = size.height - bottom - 6.dp.toPx()
            val plotW = size.width - axis
            val max = points.maxOfOrNull { it.second } ?: 0.0
            val step = niceStep(if (max > 0) max / 4 else 1.0)
            val top = (ceil(max / step) * step).coerceAtLeast(step)
            val y = { v: Double -> (6.dp.toPx() + plotH - (v / top) * plotH).toFloat() }
            var t = 0.0
            while (t <= top + 1e-9) {
                drawLine(if (t == 0.0) c.baseline else c.grid, Offset(axis, y(t)), Offset(size.width, y(t)), strokeWidth = 1.dp.toPx())
                val label = measurer.measure(formatTick(t), labelStyle)
                drawText(label, topLeft = Offset(axis - label.size.width - 6.dp.toPx(), y(t) - label.size.height / 2))
                t += step
            }
            val band = plotW / points.size.coerceAtLeast(1)
            val barW = min(24.dp.toPx(), band * 0.6f)
            val every = if (band < 34.dp.toPx()) ceil(34.dp.toPx() / band).toInt() else 1
            points.forEachIndexed { i, (label, value) ->
                val x = axis + i * band + (band - barW) / 2
                val h = (y(0.0) - y(value)).coerceAtLeast(0f)
                if (h > 0) {
                    val r = min(4.dp.toPx(), min(h, barW / 2))
                    val yTop = y(0.0) - h
                    val path = Path().apply {
                        moveTo(x, y(0.0))
                        lineTo(x, yTop + r)
                        quadraticTo(x, yTop, x + r, yTop)
                        lineTo(x + barW - r, yTop)
                        quadraticTo(x + barW, yTop, x + barW, yTop + r)
                        lineTo(x + barW, y(0.0))
                        close()
                    }
                    drawPath(path, if (selected == null || selected == i) c.series[0] else c.series[0].copy(alpha = 0.5f))
                }
                if (i % every == 0) {
                    val l = measurer.measure(label, labelStyle)
                    drawText(l, topLeft = Offset(axis + i * band + band / 2 - l.size.width / 2, size.height - l.size.height))
                }
            }
        }
    }
}
