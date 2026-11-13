package com.brickledger.app.data

import com.brickledger.app.data.local.PendingUpload
import com.brickledger.app.data.local.ProjectFile

/**
 * A photo, bill or document as the app shows it. Either a file on the server ([file]), one kept on
 * this phone ([queued] alone: phone-only projects, or an upload waiting for a connection), or a
 * server file whose new picture is waiting to be sent (both set).
 */
data class Attachment(val file: ProjectFile?, val queued: PendingUpload?) {
    init {
        require(file != null || queued != null)
    }

    /** Stable across a replacement, so the viewer stays on the same bill. */
    val key: String get() = file?.id ?: "u-${queued!!.id}"
    val name: String get() = file?.name ?: queued!!.name
    /** While a new picture waits, it is what the phone shows. */
    val mimeType: String get() = queued?.mimeType ?: file!!.mimeType
    val category: String get() = file?.category ?: queued!!.category
    val isImage: Boolean get() = mimeType.startsWith("image/")
    val waiting: Boolean get() = queued != null
}

/** Server files plus the phone's queue, with each queued replacement folded into the file it replaces. */
fun mergeAttachments(files: List<ProjectFile>, queue: List<PendingUpload>, queuedFirst: Boolean = false): List<Attachment> {
    val replacements = queue.filter { it.replacesId != null }.associateBy { it.replacesId }
    val remote = files.map { Attachment(it, replacements[it.id]) }
    val onPhone = queue.filter { it.replacesId == null }.map { Attachment(null, it) }
    return if (queuedFirst) onPhone + remote else remote + onPhone
}
