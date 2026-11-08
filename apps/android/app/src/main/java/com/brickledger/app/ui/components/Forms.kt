package com.brickledger.app.ui.components

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.brickledger.app.core.Dates
import com.brickledger.app.core.Money
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

typealias Values = Map<String, String>

/** Declarative form fields. Values are kept as strings and converted on save. */
sealed class FormField {
    abstract val key: String
    open val visible: (Values) -> Boolean = { true }

    data class Text(
        override val key: String,
        val label: String,
        val required: Boolean = false,
        val multiline: Boolean = false,
        val keyboard: KeyboardType = KeyboardType.Text,
        val placeholder: String = "",
        override val visible: (Values) -> Boolean = { true },
    ) : FormField()

    data class Amount(
        override val key: String,
        val label: String,
        val required: Boolean = false,
        val money: Boolean = true,
        val suffix: String? = null,
        override val visible: (Values) -> Boolean = { true },
    ) : FormField()

    data class Date(
        override val key: String,
        val label: String,
        val required: Boolean = false,
        override val visible: (Values) -> Boolean = { true },
    ) : FormField()

    data class Choice(
        override val key: String,
        val label: String,
        val options: List<Pair<String, String>>,
        val required: Boolean = false,
        val chips: Boolean = false,
        override val visible: (Values) -> Boolean = { true },
    ) : FormField()

    data class Toggle(override val key: String, val label: String, val description: String? = null) : FormField()

    data class Section(override val key: String, val label: String) : FormField()
}

/** Validates required fields and numbers; returns key -> message. */
fun validate(fields: List<FormField>, values: Values): Map<String, String> {
    val errors = mutableMapOf<String, String>()
    for (f in fields) {
        if (!f.visible(values)) continue
        val v = values[f.key].orEmpty().trim()
        when (f) {
            is FormField.Text -> if (f.required && v.isEmpty()) errors[f.key] = "Required"
            is FormField.Date -> if (f.required && v.isEmpty()) errors[f.key] = "Required"
            is FormField.Choice -> if (f.required && v.isEmpty()) errors[f.key] = "Choose one"
            is FormField.Amount -> when {
                f.required && v.isEmpty() -> errors[f.key] = "Required"
                v.isNotEmpty() && v.toDoubleOrNull() == null -> errors[f.key] = "Enter a number"
                v.isNotEmpty() && (v.toDoubleOrNull() ?: 0.0) < 0 -> errors[f.key] = "Can’t be negative"
                f.required && (v.toDoubleOrNull() ?: 0.0) <= 0 -> errors[f.key] = "Must be more than 0"
            }
            else -> Unit
        }
    }
    return errors
}

fun Values.str(key: String): String? = this[key]?.trim()?.takeIf { it.isNotEmpty() }
fun Values.num(key: String): Double? = this[key]?.trim()?.toDoubleOrNull()
fun Values.int(key: String): Int? = this[key]?.trim()?.toDoubleOrNull()?.toInt()
fun Values.bool(key: String): Boolean = this[key] == "true"

@Composable
fun FormFields(fields: List<FormField>, values: SnapshotStateMap<String, String>, errors: Map<String, String>, currency: String, enabled: Boolean = true) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        for (f in fields) {
            if (!f.visible(values)) continue
            when (f) {
                is FormField.Section -> SectionLabel(f.label, Modifier.padding(top = 8.dp))
                is FormField.Text -> OutlinedTextField(
                    value = values[f.key].orEmpty(),
                    onValueChange = { values[f.key] = it },
                    label = { Text(if (f.required) "${f.label} *" else f.label) },
                    placeholder = if (f.placeholder.isNotEmpty()) ({ Text(f.placeholder) }) else null,
                    isError = errors[f.key] != null,
                    supportingText = errors[f.key]?.let { { Text(it) } },
                    singleLine = !f.multiline,
                    minLines = if (f.multiline) 3 else 1,
                    enabled = enabled,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = f.keyboard,
                        capitalization = if (f.keyboard == KeyboardType.Text) KeyboardCapitalization.Sentences else KeyboardCapitalization.None,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                is FormField.Amount -> OutlinedTextField(
                    value = values[f.key].orEmpty(),
                    onValueChange = { input -> values[f.key] = input.filter { it.isDigit() || it == '.' } },
                    label = { Text(if (f.required) "${f.label} *" else f.label) },
                    prefix = if (f.money) ({ Text("${Money.symbol(currency)} ") }) else null,
                    suffix = f.suffix?.let { { Text(it) } },
                    isError = errors[f.key] != null,
                    supportingText = errors[f.key]?.let { { Text(it) } },
                    singleLine = true,
                    enabled = enabled,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
                is FormField.Date -> DateField(f.label + if (f.required) " *" else "", values[f.key], errors[f.key], enabled) { values[f.key] = it.orEmpty() }
                is FormField.Choice -> if (f.chips) {
                    Column {
                        Text(f.label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            f.options.forEach { (value, label) ->
                                FilterChip(
                                    selected = values[f.key] == value,
                                    onClick = { if (enabled) values[f.key] = value },
                                    label = { Text(label) },
                                )
                            }
                        }
                        errors[f.key]?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                    }
                } else {
                    Dropdown(f.label + if (f.required) " *" else "", f.options, values[f.key], allowEmpty = !f.required, error = errors[f.key], enabled = enabled) { values[f.key] = it.orEmpty() }
                }
                is FormField.Toggle -> Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(f.label, style = MaterialTheme.typography.bodyLarge)
                        f.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    Switch(checked = values[f.key] == "true", onCheckedChange = { values[f.key] = it.toString() }, enabled = enabled)
                }
            }
        }
    }
}

@Composable
fun Dropdown(
    label: String,
    options: List<Pair<String, String>>,
    value: String?,
    allowEmpty: Boolean = true,
    error: String? = null,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
    onChange: (String?) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = options.firstOrNull { it.first == value }?.second.orEmpty()
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { if (enabled) expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = selectedLabel,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(label) },
            isError = error != null,
            supportingText = error?.let { { Text(it) } },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable, enabled).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (allowEmpty) {
                DropdownMenuItem(text = { Text("None", color = MaterialTheme.colorScheme.onSurfaceVariant) }, onClick = { onChange(null); expanded = false })
            }
            options.forEach { (v, l) ->
                DropdownMenuItem(text = { Text(l) }, onClick = { onChange(v); expanded = false })
            }
        }
    }
}

@Composable
fun DateField(label: String, value: String?, error: String? = null, enabled: Boolean = true, onChange: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    OutlinedTextField(
        value = if (value.isNullOrBlank()) "" else Dates.format(value),
        onValueChange = {},
        readOnly = true,
        enabled = enabled,
        label = { Text(label) },
        isError = error != null,
        supportingText = error?.let { { Text(it) } },
        trailingIcon = {
            if (!value.isNullOrBlank() && !label.endsWith("*")) {
                IconButton(onClick = { onChange(null) }) { Icon(Icons.Rounded.Close, contentDescription = "Clear date") }
            } else {
                Icon(Icons.Rounded.CalendarMonth, contentDescription = null)
            }
        },
        interactionSource = interaction,
        modifier = Modifier.fillMaxWidth(),
    )
    // Read-only text fields consume clicks for focus; open the picker when the field is released.
    androidx.compose.runtime.LaunchedEffect(interaction) {
        interaction.interactions.collect { if (it is androidx.compose.foundation.interaction.PressInteraction.Release && enabled) open = true }
    }
    if (open) {
        val initial = value?.takeIf { it.isNotBlank() }?.let { LocalDate.parse(it).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }
            ?: LocalDate.now().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        val state = rememberDatePickerState(initialSelectedDateMillis = initial)
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { onChange(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) }
                    open = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
        ) { DatePicker(state = state) }
    }
}
