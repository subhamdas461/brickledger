package com.brickledger.app.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.Flow

/**
 * Collects a flow that is built once per [keys].
 *
 * Writing `dao.observe(id).collectAsStateWithLifecycle(...)` inline creates a new Flow on every
 * recomposition, and each new instance restarts the collection - re-running the query on every
 * keystroke or tab switch. Remembering the flow keeps one subscription per key.
 */
@Composable
fun <T> rememberFlowState(vararg keys: Any?, initial: T, factory: () -> Flow<T>): State<T> =
    remember(*keys) { factory() }.collectAsStateWithLifecycle(initialValue = initial)
