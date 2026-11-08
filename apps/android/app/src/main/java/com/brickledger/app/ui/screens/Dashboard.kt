package com.brickledger.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ReceiptLong
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.Engineering
import androidx.compose.material.icons.rounded.Error
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.ReportProblem
import androidx.compose.material3.AssistChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.brickledger.app.AppContainer
import com.brickledger.app.core.Dates
import com.brickledger.app.core.Money
import com.brickledger.app.data.DashboardState
import com.brickledger.app.data.local.ProjectEntity
import com.brickledger.app.ui.components.AlertRow
import com.brickledger.app.ui.components.CardTitle
import com.brickledger.app.ui.components.ColumnChart
import com.brickledger.app.ui.components.LoadingBox
import com.brickledger.app.ui.components.Meter
import com.brickledger.app.ui.components.SectionCard
import com.brickledger.app.ui.components.Segment
import com.brickledger.app.ui.components.SegmentedBar
import com.brickledger.app.ui.components.StatTile
import com.brickledger.app.ui.components.StatusChip
import com.brickledger.app.ui.components.Tone
import com.brickledger.app.ui.navigation.ProjectNav
import com.brickledger.app.ui.theme.HeroNumber
import com.brickledger.app.ui.theme.LocalChartColors

@Composable
fun DashboardTab(container: AppContainer, nav: ProjectNav, project: ProjectEntity) {
    val flow = remember(project.id) { container.repo.dashboard(project.id) }
    val state by flow.collectAsStateWithLifecycle(initialValue = null)
    val s = state ?: return LoadingBox()
    val cur = project.currency
    val money = { v: Double -> Money.format(v, cur) }
    val compact = { v: Double -> Money.compact(v, cur) }

    LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { HeroCard(s, compact, money) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile("Paid so far", compact(s.paid), Modifier.weight(1f), note = "${compact(s.labourPaid)} wages")
                val c = LocalChartColors.current
                StatTile(
                    "Bills due", compact(s.due), Modifier.weight(1f),
                    note = if (s.overdue > 0) "${compact(s.overdue)} overdue" else "Nothing overdue",
                    noteColor = if (s.overdue > 0) c.critical else c.good,
                )
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(
                    "Cash in hand", compact(s.cashInHand), Modifier.weight(1f),
                    note = "${compact(s.fundsReceived)} received",
                    noteColor = if (s.cashInHand < 0) LocalChartColors.current.critical else androidx.compose.ui.graphics.Color.Unspecified,
                )
                StatTile(
                    "Progress", "${s.progress}%", Modifier.weight(1f),
                    note = s.costPerArea?.let { "${money(Math.round(it).toDouble())}/${if (project.areaUnit == "sqm") "sq m" else "sq ft"}" } ?: "Add built-up area",
                )
            }
        }
        if (project.canEdit) {
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { QuickAction(Icons.AutoMirrored.Rounded.ReceiptLong, "Expense") { nav.form("expense") } }
                    item { QuickAction(Icons.Rounded.EditNote, "Diary entry") { nav.form("log") } }
                    item { QuickAction(Icons.Rounded.ReportProblem, "Report issue") { nav.form("issue") } }
                    item { QuickAction(Icons.Rounded.CheckCircle, "Task") { nav.form("task") } }
                }
            }
        }
        if (s.alerts.isNotEmpty()) {
            item {
                SectionCard(padding = 12.dp) {
                    s.alerts.take(5).forEachIndexed { i, a ->
                        if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        AlertRow(a) {
                            when (a.target) {
                                "budget", "tasks", "issues" -> nav.section(a.target)
                                else -> Unit
                            }
                        }
                    }
                }
            }
        }
        item {
            SectionCard {
                CardTitle("Monthly spending", "Paid expenses per month ($cur)")
                Spacer(Modifier.height(12.dp))
                if (s.monthly.all { it.second == 0.0 }) {
                    Text("No paid expenses yet - the chart fills in as you record payments.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 24.dp))
                } else {
                    ColumnChart(s.monthly.map { Dates.month(it.first) to it.second }, money, { v -> if (v == 0.0) "0" else compact(v).replace(Money.symbol(cur), "") })
                }
            }
        }
        val ranked = s.categories.filter { it.committed > 0 }.sortedByDescending { it.committed }
        if (ranked.isNotEmpty()) {
            item {
                val c = LocalChartColors.current
                val top = ranked.take(5)
                val other = ranked.drop(5).sumOf { it.committed }
                SectionCard {
                    CardTitle("Where the money went", "Top categories by committed spend")
                    Spacer(Modifier.height(12.dp))
                    SegmentedBar(
                        parts = top.mapIndexed { i, l -> Segment(l.name, l.committed, c.series[i], darkText = i == 3) } +
                            if (other > 0) listOf(Segment("Other", other, c.other, darkText = true)) else emptyList(),
                        total = ranked.sumOf { it.committed },
                        format = money,
                    )
                }
            }
            item {
                SectionCard {
                    CardTitle("Budget by category", "Committed vs planned") { TextButton(onClick = { nav.section("budget") }) { Text("All") } }
                    Spacer(Modifier.height(8.dp))
                    s.categories.filter { it.planned > 0 || it.committed > 0 }.sortedByDescending { it.committed }.take(6).forEach { l ->
                        Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp)) {
                            Text(l.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f), maxLines = 1)
                            Text("${compact(l.committed)} / ${compact(l.planned)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Meter(l.committed, l.planned)
                    }
                }
            }
        }
        item {
            SectionCard {
                CardTitle("Today on site")
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MiniStat(Icons.Rounded.Engineering, "${s.presentToday}/${s.activeWorkers}", "Present", Modifier.weight(1f))
                    MiniStat(Icons.Rounded.CheckCircle, "${s.openTasks}", if (s.overdueTasks > 0) "${s.overdueTasks} overdue" else "Open tasks", Modifier.weight(1f))
                    MiniStat(Icons.Rounded.Error, "${s.openIssues}", "Issues", Modifier.weight(1f))
                    MiniStat(Icons.Rounded.Inventory2, "${s.lowStock}", "Low stock", Modifier.weight(1f))
                }
            }
        }
        if (s.phases.isNotEmpty()) {
            item {
                SectionCard {
                    CardTitle("Schedule", "${s.progress}% overall") { TextButton(onClick = { nav.section("schedule") }) { Text("Open") } }
                    s.phases.take(7).forEach { ph ->
                        Row(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 4.dp)) {
                            Text(ph.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f), maxLines = 1)
                            Text(if (ph.progress == 100) "Done" else "${ph.progress}%", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Meter(ph.progress.toDouble(), 100.0, progress = true, height = 6.dp)
                    }
                }
            }
        }
        if (s.recent.isNotEmpty()) {
            item { Text("Recent expenses", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp)) }
            items(s.recent, key = { "r-${it.id}" }) { e ->
                ExpenseRow(e, cur, s.vendorNames[e.vendorId] ?: s.categoryNames[e.categoryId] ?: Dates.format(e.date)) { nav.form("expense", e.id) }
            }
        }
    }
}

@Composable
private fun HeroCard(s: DashboardState, compact: (Double) -> String, money: (Double) -> String) {
    val c = LocalChartColors.current
    val over = s.budget > 0 && s.committed > s.budget
    SectionCard(padding = 20.dp) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text("Committed so far", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(compact(s.committed), style = HeroNumber)
                Text(
                    if (s.budget > 0) "${((s.committed / s.budget) * 100).toInt()}% of ${money(s.budget)}" else "Set a budget to track progress",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (s.budget > 0) {
                StatusChip(if (over) "Over by ${compact(s.committed - s.budget)}" else "${compact(s.remaining)} left", if (over) Tone.Red else Tone.Green)
            }
        }
        Spacer(Modifier.height(16.dp))
        SegmentedBar(
            parts = listOf(
                Segment("Paid", s.paid, c.series[0]),
                Segment("Bills due", s.due, c.series[1]),
                Segment("Remaining", (s.budget - s.committed).coerceAtLeast(0.0), c.other, darkText = true),
            ),
            total = maxOf(s.budget, s.committed),
            format = money,
        )
    }
}

@Composable
private fun QuickAction(icon: ImageVector, label: String, onClick: () -> Unit) {
    AssistChip(onClick = onClick, label = { Text(label) }, leadingIcon = { Icon(icon, null) })
}

@Composable
private fun MiniStat(icon: ImageVector, value: String, label: String, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.Start) {
        Icon(icon, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 4.dp))
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        Spacer(Modifier.width(2.dp))
    }
}
