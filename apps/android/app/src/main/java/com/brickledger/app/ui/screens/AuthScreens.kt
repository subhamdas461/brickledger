package com.brickledger.app.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.brickledger.app.AppContainer
import com.brickledger.app.BuildConfig
import com.brickledger.app.R
import com.brickledger.app.data.remote.userMessage
import kotlinx.coroutines.launch

@Composable
private fun AuthLayout(title: String, subtitle: String, onServer: (() -> Unit)?, content: @Composable () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(color = MaterialTheme.colorScheme.primary, shape = RoundedCornerShape(12.dp), modifier = Modifier.size(40.dp)) {
                    Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, modifier = Modifier.clip(RoundedCornerShape(12.dp)))
                }
                Spacer(Modifier.width(10.dp))
                Text("BrickLedger", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (onServer != null) IconButton(onClick = onServer) { Icon(Icons.Rounded.Dns, contentDescription = "Server settings") }
            }
            Spacer(Modifier.height(56.dp))
            Text(title, style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(6.dp))
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(28.dp))
            content()
        }
    }
}

@Composable
private fun PasswordField(value: String, onChange: (String) -> Unit, label: String = "Password") {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        trailingIcon = {
            IconButton(onClick = { visible = !visible }) {
                Icon(if (visible) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility, contentDescription = if (visible) "Hide password" else "Show password")
            }
        },
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun ServerDialog(container: AppContainer, onDismiss: () -> Unit) {
    var url by remember { mutableStateOf(container.session.baseUrl) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Server address") },
        text = {
            Column {
                Text("Use your own BrickLedger server or a local development API.", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(url, { url = it }, singleLine = true, label = { Text("URL") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
                TextButton(onClick = { url = BuildConfig.DEFAULT_API_URL }) { Text("Reset to default") }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                scope.launch { container.session.setBaseUrl(url) }
                onDismiss()
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun LoginScreen(container: AppContainer, onSignedIn: () -> Unit, onRegister: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var server by remember { mutableStateOf(false) }
    var forgot by remember { mutableStateOf(false) }
    var offlineDialog by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val pickBackup = rememberBackupPicker(container)

    AuthLayout("Welcome back", "Sign in to track your build.", onServer = { server = true }) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
            PasswordField(password, { password = it })
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            Button(
                onClick = {
                    if (busy) return@Button
                    busy = true
                    error = null
                    scope.launch {
                        runCatching { container.repo.login(email, password) }
                            .onSuccess { onSignedIn() }
                            .onFailure { error = it.userMessage() }
                        busy = false
                    }
                },
                enabled = !busy && email.isNotBlank() && password.isNotBlank(),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(if (busy) "Signing in…" else "Sign in") }
            TextButton(onClick = { forgot = true }, modifier = Modifier.align(Alignment.End)) { Text("Forgot password?") }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Text("New to BrickLedger?", color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onRegister) { Text("Create an account") }
            }
            HorizontalDivider(Modifier.padding(vertical = 12.dp), color = MaterialTheme.colorScheme.outlineVariant)
            Text("No internet on site?", style = MaterialTheme.typography.titleSmall)
            Text(
                "Use BrickLedger on this phone without an account. Everything is saved on the phone - back it up to a file anytime, or move it to the cloud later.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(onClick = { offlineDialog = true }, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                Icon(Icons.Rounded.CloudOff, null)
                Spacer(Modifier.width(8.dp))
                Text("Use offline on this phone")
            }
            // New phone: bring a project over from a backup file without signing in.
            TextButton(onClick = pickBackup, modifier = Modifier.fillMaxWidth()) { Text("Restore a backup from another phone") }
        }
    }
    if (offlineDialog) {
        var name by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { offlineDialog = false },
            title = { Text("Use offline") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Projects you create are stored only on this phone. No sign-in or internet needed.", style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(name, { name = it }, label = { Text("Your name (optional)") }, singleLine = true)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    offlineDialog = false
                    scope.launch {
                        container.repo.enterOfflineMode(name)
                        onSignedIn()
                    }
                }) { Text("Continue") }
            },
            dismissButton = { TextButton(onClick = { offlineDialog = false }) { Text("Cancel") } },
        )
    }
    if (server) ServerDialog(container) { server = false }
    if (forgot) {
        var sent by remember { mutableStateOf(false) }
        var forgotEmail by remember { mutableStateOf(email) }
        AlertDialog(
            onDismissRequest = { forgot = false },
            title = { Text("Reset password") },
            text = {
                if (sent) Text("If an account exists for $forgotEmail, a reset link is on its way.")
                else OutlinedTextField(forgotEmail, { forgotEmail = it }, label = { Text("Email") }, singleLine = true)
            },
            confirmButton = {
                TextButton(onClick = {
                    if (sent) forgot = false
                    else scope.launch { runCatching { container.repo.forgotPassword(forgotEmail) }; sent = true }
                }) { Text(if (sent) "Done" else "Send link") }
            },
            dismissButton = { if (!sent) TextButton(onClick = { forgot = false }) { Text("Cancel") } },
        )
    }
}

@Composable
fun RegisterScreen(container: AppContainer, onSignedIn: () -> Unit, onBack: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var company by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val invited = container.session.pendingInvite != null

    AuthLayout(
        if (invited) "Create your account to join" else "Start your free trial",
        if (invited) "You were invited to a project." else "14 days of Pro. No credit card needed.",
        onServer = null,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(name, { name = it }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
            PasswordField(password, { password = it })
            Text("At least 8 characters.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (!invited) OutlinedTextField(company, { company = it }, label = { Text("Company or family name (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            Button(
                onClick = {
                    if (busy) return@Button
                    busy = true
                    error = null
                    scope.launch {
                        runCatching { container.repo.register(name, email, password, company) }
                            .onSuccess { onSignedIn() }
                            .onFailure { error = it.userMessage() }
                        busy = false
                    }
                },
                enabled = !busy && name.isNotBlank() && email.isNotBlank() && password.length >= 8,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(if (busy) "Creating account…" else "Create account") }
            Text(
                "By creating an account you agree to the Terms of Service and Privacy Policy.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = onBack, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("I already have an account") }
        }
    }
}
