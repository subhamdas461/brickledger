package com.brickledger.app.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.OpenableColumns
import com.brickledger.app.core.newId
import java.io.File
import kotlin.math.max

/** Prepares photos/documents for upload: images are downscaled + recompressed to save data. */
object Images {
    private const val MAX_SIDE = 1600

    data class Prepared(val file: File, val fileName: String, val mimeType: String)

    fun pendingDir(context: Context) = File(context.filesDir, "pending").apply { mkdirs() }

    fun cameraFile(context: Context): File = File(File(context.cacheDir, "camera").apply { mkdirs() }, "${newId()}.jpg")

    fun prepare(context: Context, uri: Uri): Prepared {
        val resolver = context.contentResolver
        val mime = resolver.getType(uri) ?: if (uri.toString().endsWith(".jpg")) "image/jpeg" else "application/octet-stream"
        val displayName = runCatching {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
        }.getOrNull() ?: "photo-${System.currentTimeMillis()}.jpg"
        val out = File(pendingDir(context), newId())
        if (mime.startsWith("image/") && mime != "image/gif") {
            val compressed = compress(context, uri, out)
            if (compressed) return Prepared(out, displayName.substringBeforeLast('.') + ".jpg", "image/jpeg")
        }
        resolver.openInputStream(uri)?.use { input -> out.outputStream().use { input.copyTo(it) } }
        return Prepared(out, displayName, mime)
    }

    private fun compress(context: Context, uri: Uri, out: File): Boolean = runCatching {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0) return false
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
        val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
            ?: return false
        val rotation = resolver.openInputStream(uri)?.use {
            when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } ?: 0f
        val scale = MAX_SIDE.toFloat() / max(decoded.width, decoded.height)
        val matrix = Matrix().apply {
            if (scale < 1f) postScale(scale, scale)
            if (rotation != 0f) postRotate(rotation)
        }
        val finalBitmap = if (!matrix.isIdentity) Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true) else decoded
        out.outputStream().use { finalBitmap.compress(Bitmap.CompressFormat.JPEG, 80, it) }
        if (finalBitmap !== decoded) decoded.recycle()
        finalBitmap.recycle()
        true
    }.getOrDefault(false)
}
