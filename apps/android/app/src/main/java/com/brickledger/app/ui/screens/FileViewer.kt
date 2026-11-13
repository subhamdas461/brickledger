package com.brickledger.app.ui.screens

import android.net.Uri
import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.FindReplace
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material.icons.rounded.PictureAsPdf
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.brickledger.app.AppContainer
import com.brickledger.app.core.Vocab
import com.brickledger.app.data.Attachment
import com.brickledger.app.data.Images
import com.brickledger.app.data.local.ProjectEntity
import com.brickledger.app.data.remote.userMessage
import com.brickledger.app.ui.components.ConfirmDialog
import java.io.File
import kotlinx.coroutines.launch

/** What Coil loads: the picture on the phone while one is there (new or replacement), else the server's. */
fun attachmentModel(container: AppContainer, a: Attachment): Any = a.queued?.let { File(it.path) } ?: container.repo.fileUrl(a.file!!)

/** A tappable thumbnail; a badge marks pictures still waiting to upload. */
@Composable
fun AttachmentThumb(container: AppContainer, a: Attachment, phoneOnly: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(modifier.clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant).clickable(onClickLabel = "View", onClick = onClick)) {
        if (a.isImage) {
            AsyncImage(model = attachmentModel(container, a), contentDescription = a.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Column(Modifier.fillMaxSize().padding(6.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(fileIcon(a), null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(28.dp))
                Text(a.name, style = MaterialTheme.typography.labelSmall, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            }
        }
        // Phone-only projects keep everything on the phone; nothing is waiting.
        if (a.waiting && !phoneOnly) {
            Icon(
                Icons.Rounded.Sync,
                contentDescription = "Waiting to upload",
                tint = Color.White,
                modifier = Modifier.align(Alignment.BottomEnd).padding(4.dp).size(18.dp).clip(CircleShape).background(Color(0x99000000)).padding(2.dp),
            )
        }
    }
}

private fun fileIcon(a: Attachment): ImageVector = if (a.mimeType == "application/pdf") Icons.Rounded.PictureAsPdf else Icons.Rounded.Description

/**
 * Full-screen viewer for bills, photos and documents: swipe between them, pinch or double-tap to
 * zoom, and edit, replace or delete. Works offline; changes sync like everything else.
 */
@Composable
fun FileViewer(container: AppContainer, project: ProjectEntity, items: List<Attachment>, startKey: String, noun: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val profile by container.session.profile.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var currentKey by rememberSaveable { mutableStateOf(startKey) }
    var editing by remember { mutableStateOf<Attachment?>(null) }
    var deleting by remember { mutableStateOf<Attachment?>(null) }
    var replaceMenu by remember { mutableStateOf(false) }
    var replacingKey by rememberSaveable { mutableStateOf<String?>(null) }
    var cameraUri by rememberSaveable { mutableStateOf<Uri?>(null) }
    var zoomed by remember { mutableStateOf(false) }
    val latest by rememberUpdatedState(items)
    val title = noun.replaceFirstChar { it.uppercase() }

    fun replaceWith(uri: Uri?) {
        val target = latest.firstOrNull { it.key == replacingKey }
        replacingKey = null
        if (uri == null || target == null) return
        scope.launch {
            runCatching { container.repo.replaceAttachment(target, uri) }
                .onSuccess { snackbar.showSnackbar(if (project.isLocal) "$title replaced" else "$title replaced - uploads when online") }
                .onFailure { snackbar.showSnackbar(it.userMessage()) }
        }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> replaceWith(if (ok) cameraUri else null) }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { replaceWith(it) }
    val document = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { replaceWith(it) }

    // Everything shown here is gone (the last one deleted): close.
    LaunchedEffect(items.isEmpty()) { if (items.isEmpty()) onDismiss() }
    if (items.isEmpty()) return

    val pager = rememberPagerState(initialPage = items.indexOfFirst { it.key == currentKey }.coerceAtLeast(0)) { items.size }
    // The list is live: stay on the same file when others are added, replaced or removed.
    LaunchedEffect(items) {
        val i = items.indexOfFirst { it.key == currentKey }
        if (i >= 0 && i != pager.currentPage) pager.scrollToPage(i)
    }
    LaunchedEffect(pager) {
        snapshotFlow { pager.currentPage }.collect { page -> latest.getOrNull(page)?.let { currentKey = it.key } }
    }
    val current = items.getOrNull(pager.currentPage) ?: items.first()

    val me = profile?.user?.id
    val canEdit = project.canEdit
    // Replacing destroys the original, so it follows the delete rule: managers, or whoever added it.
    fun canChange(a: Attachment) = canEdit && (a.file == null || project.isManager || a.file.createdBy == me || (a.file.createdBy == null && a.file.serverSeq == 0L))
    fun openElsewhere(a: Attachment) = scope.launch {
        runCatching { container.repo.localCopy(a) }
            .onSuccess { openFile(context, it, a.mimeType) }
            .onFailure { snackbar.showSnackbar(it.userMessage()) }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(state = pager, userScrollEnabled = !zoomed, key = { latest.getOrNull(it)?.key ?: it }, modifier = Modifier.fillMaxSize()) { page ->
                val a = items.getOrNull(page) ?: return@HorizontalPager
                if (a.isImage) {
                    ZoomableImage(attachmentModel(container, a), a.name, active = page == pager.currentPage) { z -> if (page == pager.currentPage) zoomed = z }
                } else {
                    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(fileIcon(a), null, tint = Color.White.copy(alpha = 0.8f), modifier = Modifier.size(64.dp))
                        Spacer(Modifier.height(12.dp))
                        Text(a.name, color = Color.White, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(16.dp))
                        FilledTonalButton(onClick = { openElsewhere(a) }) { Text(if (a.mimeType == "application/pdf") "Open PDF" else "Open") }
                    }
                }
            }

            // Top: close, name, details.
            Row(
                Modifier.fillMaxWidth().background(Color(0xB3000000)).windowInsetsPadding(WindowInsets.statusBars).padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDismiss) { Icon(Icons.Rounded.Close, "Close", tint = Color.White) }
                Column(Modifier.weight(1f)) {
                    Text(current.name, color = Color.White, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val details = listOfNotNull(
                        "${pager.currentPage + 1} of ${items.size}".takeIf { items.size > 1 },
                        Vocab.label(Vocab.fileCategories, current.category),
                        current.file?.sizeBytes?.takeIf { !current.waiting && it > 0 }?.let { Formatter.formatShortFileSize(context, it) },
                        if (!current.waiting) null else if (project.isLocal) "On this phone" else "Waiting to upload",
                    )
                    Text(details.joinToString(" · "), color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = { openElsewhere(current) }) { Icon(Icons.AutoMirrored.Rounded.OpenInNew, "Open in another app", tint = Color.White) }
            }

            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
                SnackbarHost(snackbar)
                current.file?.notes?.let {
                    Text(it, color = Color.White, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.fillMaxWidth().background(Color(0xB3000000)).padding(horizontal = 16.dp, vertical = 8.dp))
                }
                if (canEdit) {
                    Row(
                        Modifier.fillMaxWidth().background(Color(0xB3000000)).windowInsetsPadding(WindowInsets.navigationBars).padding(vertical = 6.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        ViewerAction(Icons.Rounded.Edit, "Edit") { editing = current }
                        if (canChange(current)) {
                            Box {
                                ViewerAction(Icons.Rounded.FindReplace, "Replace") { replaceMenu = true }
                                DropdownMenu(expanded = replaceMenu, onDismissRequest = { replaceMenu = false }) {
                                    DropdownMenuItem(text = { Text("Take a photo") }, leadingIcon = { Icon(Icons.Rounded.PhotoCamera, null) }, onClick = {
                                        replaceMenu = false
                                        replacingKey = current.key
                                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", Images.cameraFile(context))
                                        cameraUri = uri
                                        camera.launch(uri)
                                    })
                                    DropdownMenuItem(text = { Text("Choose from gallery") }, leadingIcon = { Icon(Icons.Rounded.PhotoLibrary, null) }, onClick = {
                                        replaceMenu = false
                                        replacingKey = current.key
                                        gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                                    })
                                    DropdownMenuItem(text = { Text("Choose a file (PDF)") }, leadingIcon = { Icon(Icons.Rounded.FolderOpen, null) }, onClick = {
                                        replaceMenu = false
                                        replacingKey = current.key
                                        document.launch(arrayOf("image/*", "application/pdf"))
                                    })
                                }
                            }
                            ViewerAction(Icons.Rounded.Delete, "Delete") { deleting = current }
                        }
                    }
                }
            }
        }

        editing?.let { a ->
            var name by rememberSaveable(a.key) { mutableStateOf(a.name) }
            var notes by rememberSaveable(a.key) { mutableStateOf(a.file?.notes.orEmpty()) }
            AlertDialog(
                onDismissRequest = { editing = null },
                title = { Text("Edit $noun") },
                text = {
                    Column {
                        OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, isError = name.isBlank(), modifier = Modifier.fillMaxWidth())
                        // Notes live on the server copy; a picture only on this phone has just a name.
                        if (a.file != null) {
                            Spacer(Modifier.height(8.dp))
                            OutlinedTextField(notes, { notes = it }, label = { Text("Notes") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                        }
                    }
                },
                confirmButton = {
                    TextButton(enabled = name.isNotBlank(), onClick = {
                        editing = null
                        scope.launch {
                            container.repo.renameAttachment(a, name, if (a.file != null) notes else null)
                            snackbar.showSnackbar("Saved")
                        }
                    }) { Text("Save") }
                },
                dismissButton = { TextButton(onClick = { editing = null }) { Text("Cancel") } },
            )
        }

        deleting?.let { a ->
            ConfirmDialog(
                title = "Delete this $noun?",
                message = if (a.file == null) "“${a.name}” is removed from this phone." else "“${a.name}” is removed for everyone on the project. This can’t be undone.",
                onConfirm = {
                    deleting = null
                    // Move to a neighbour first, so the viewer stays open on something real.
                    val i = latest.indexOfFirst { it.key == a.key }
                    (latest.getOrNull(i + 1) ?: latest.getOrNull(i - 1))?.let { currentKey = it.key }
                    scope.launch {
                        container.repo.deleteAttachment(a)
                        snackbar.showSnackbar("$title deleted")
                    }
                },
                onDismiss = { deleting = null },
            )
        }
    }
}

@Composable
private fun ViewerAction(icon: ImageVector, label: String, onClick: () -> Unit) {
    Column(
        Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, tint = Color.White)
        Text(label, color = Color.White, style = MaterialTheme.typography.labelMedium)
    }
}

/** Pinch to zoom, drag to pan when zoomed, double-tap to zoom in where you tap (and back out). */
@Composable
private fun ZoomableImage(model: Any, description: String, active: Boolean, onZoomChange: (Boolean) -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    LaunchedEffect(active) {
        if (!active) {
            scale = 1f
            offset = Offset.Zero
        }
    }
    LaunchedEffect(scale > 1f) { onZoomChange(scale > 1f) }
    fun clamp(o: Offset, s: Float): Offset {
        val maxX = size.width * (s - 1f) / 2f
        val maxY = size.height * (s - 1f) / 2f
        return Offset(o.x.coerceIn(-maxX, maxX), o.y.coerceIn(-maxY, maxY))
    }
    AsyncImage(
        model = model,
        contentDescription = description,
        contentScale = ContentScale.Fit,
        modifier = Modifier
            .fillMaxSize()
            // A zoomed picture stays in its area instead of spilling behind the status and navigation bars.
            .clipToBounds()
            .onSizeChanged { size = it }
            .pointerInput(Unit) {
                detectTapGestures(onDoubleTap = { tap ->
                    if (scale > 1f) {
                        scale = 1f
                        offset = Offset.Zero
                    } else {
                        val s = 2.5f
                        scale = s
                        offset = clamp((Offset(size.width / 2f, size.height / 2f) - tap) * (s - 1f), s)
                    }
                })
            }
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        // One finger at normal size belongs to the pager (swipe to the next file).
                        if (event.changes.count { it.pressed } > 1 || scale > 1f) {
                            val s = (scale * event.calculateZoom()).coerceIn(1f, 5f)
                            offset = if (s == 1f) Offset.Zero else clamp(offset + event.calculatePan(), s)
                            scale = s
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                }
            }
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                translationX = offset.x
                translationY = offset.y
            },
    )
}
