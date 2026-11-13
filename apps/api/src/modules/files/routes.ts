import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { fileSchema } from '@brickledger/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { files } from '../../db/schema';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors';
import { isUuid } from '../../lib/util';
import { parse } from '../../lib/validate';
import { logActivity } from '../activity';
import { assertStorage } from '../billing/limits';
import { loadProjectAccess, projectAccess, requireRole } from '../projects/access';
import { RESOURCES } from '../resources/registry';
import { findRow, serializeRow } from '../resources/service';

/** Allowed upload types -> stored extension. SVG/HTML are deliberately excluded (XSS). */
const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/zip': '.zip',
  'image/vnd.dwg': '.dwg',
  'application/acad': '.dwg',
  'image/vnd.dxf': '.dxf',
};
const CAD_EXTENSIONS = new Set(['.dwg', '.dxf']);
const INLINE = (mime: string) => mime.startsWith('image/') || mime === 'application/pdf';

interface Upload {
  buffer: Buffer;
  filename: string;
  mime: string;
  /** Extension used in the storage key. */
  storedExt: string;
}

/** Reads a multipart request: the `file` part plus any text fields. Rejects empty, oversized and unsafe files. */
async function readUpload(req: FastifyRequest, maxMb: number): Promise<{ fields: Record<string, string>; upload: Upload }> {
  if (!req.isMultipart()) throw badRequest('Send the file as multipart/form-data.');
  const fields: Record<string, string> = {};
  let raw: { buffer: Buffer; filename: string; mimetype: string } | null = null;
  try {
    for await (const part of req.parts({ limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 20 } })) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        if (part.file.truncated) throw new AppError(413, 'PAYLOAD_TOO_LARGE', `Files can be up to ${maxMb} MB.`);
        raw = { buffer, filename: part.filename || 'upload', mimetype: part.mimetype };
      } else {
        fields[part.fieldname] = String(part.value ?? '');
      }
    }
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    if (err?.code === 'FST_REQ_FILE_TOO_LARGE') throw new AppError(413, 'PAYLOAD_TOO_LARGE', `Files can be up to ${maxMb} MB.`);
    throw err;
  }
  if (!raw || raw.buffer.length === 0) throw badRequest('Choose a file to upload.');

  const ext = extname(raw.filename).toLowerCase();
  const mime = raw.mimetype.toLowerCase();
  const cad = mime === 'application/octet-stream' && CAD_EXTENSIONS.has(ext);
  if (!cad && !ALLOWED[mime]) throw badRequest('This file type is not supported. Upload images, PDFs, Office documents or drawings.');
  return { fields, upload: { buffer: raw.buffer, filename: raw.filename.slice(0, 200), mime, storedExt: ALLOWED[mime] ?? ext } };
}

export async function fileRoutes(app: FastifyInstance) {
  const { db, tokens, storage, config } = app.ctx;

  /**
   * multipart/form-data: `file` plus optional fields id, name, category, entityType,
   * entityId, expiresOn, notes. Re-sending the same client `id` is idempotent.
   */
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/files', { onRequest: app.authenticate }, async (req, reply) => {
    const access = await projectAccess(req, req.params.projectId);
    requireRole(access, 'contributor', 'upload files');
    const { fields, upload } = await readUpload(req, config.MAX_UPLOAD_MB);

    // Idempotent retry from an offline client.
    const clientId = isUuid(fields.id) ? fields.id : null;
    if (clientId) {
      const [existing] = await db.select().from(files).where(and(eq(files.id, clientId), eq(files.projectId, access.project.id))).limit(1);
      if (existing) return serializeRow(RESOURCES.files, existing, tokens);
    }

    const meta = parse(fileSchema, {
      name: fields.name || upload.filename.replace(/\.[^.]+$/, '') || 'File',
      category: fields.category || (upload.mime.startsWith('image/') ? 'photo' : 'other'),
      entityType: fields.entityType || null,
      entityId: fields.entityId || null,
      expiresOn: fields.expiresOn || null,
      notes: fields.notes || null,
    });

    await assertStorage(db, access.org, upload.buffer.length);
    const id = clientId ?? randomUUID();
    const storageKey = `${access.project.id}/${id}${upload.storedExt}`;
    await storage.put(storageKey, upload.buffer, upload.mime);

    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(files)
        .values({
          ...meta,
          id,
          projectId: access.project.id,
          fileName: upload.filename,
          mimeType: upload.mime,
          sizeBytes: upload.buffer.length,
          storageKey,
          createdBy: access.userId,
          updatedBy: access.userId,
        })
        .returning();
      await logActivity(tx, {
        projectId: access.project.id,
        userId: access.userId,
        action: 'create',
        entityType: 'files',
        entityId: id,
        summary: `Uploaded ${meta.category === 'photo' ? 'photo' : 'file'} "${meta.name}"`,
      });
      return inserted!;
    });
    reply.code(201);
    return serializeRow(RESOURCES.files, row, tokens);
  });

  /**
   * Replaces a file's content (multipart `file`), keeping its id, name, notes and what it's attached to.
   * Like deleting, it destroys the original, so contributors may only replace files they added.
   */
  app.put<{ Params: { projectId: string; fileId: string } }>('/projects/:projectId/files/:fileId/content', { onRequest: app.authenticate }, async (req) => {
    const access = await projectAccess(req, req.params.projectId);
    requireRole(access, 'contributor', 'replace files');
    const existing = await findRow(db, RESOURCES.files, access.project.id, req.params.fileId);
    if (!existing) throw notFound('File');
    if (access.role !== 'manager' && existing.createdBy !== access.userId) {
      throw forbidden('Contributors can only replace files they added. Ask a project manager.');
    }
    const { upload } = await readUpload(req, config.MAX_UPLOAD_MB);

    const growth = upload.buffer.length - Number(existing.sizeBytes ?? 0);
    if (growth > 0) await assertStorage(db, access.org, growth);
    // A new key, never the old one: the old object stays intact until the database points elsewhere.
    const storageKey = `${access.project.id}/${existing.id}-${randomUUID().slice(0, 8)}${upload.storedExt}`;
    await storage.put(storageKey, upload.buffer, upload.mime);

    let row;
    try {
      row = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(files)
          .set({
            fileName: upload.filename,
            mimeType: upload.mime,
            sizeBytes: upload.buffer.length,
            storageKey,
            updatedBy: access.userId,
            updatedAt: new Date(),
            serverSeq: sql`nextval('sync_seq')`,
          })
          .where(and(eq(files.id, existing.id), isNull(files.deletedAt)))
          .returning();
        if (!updated) throw notFound('File');
        await logActivity(tx, {
          projectId: access.project.id,
          userId: access.userId,
          action: 'update',
          entityType: 'files',
          entityId: existing.id,
          summary: `Replaced file "${existing.name}"`,
        });
        return updated;
      });
    } catch (err) {
      await storage.delete(storageKey).catch(() => undefined);
      throw err;
    }
    if (existing.storageKey !== storageKey) await storage.delete(existing.storageKey).catch(() => undefined);
    return serializeRow(RESOURCES.files, row, tokens);
  });

  /** File bytes. Authorised by a signed URL (for <img>) or a bearer token (mobile). */
  app.get<{ Params: { fileId: string }; Querystring: { exp?: string; sig?: string; download?: string } }>(
    '/files/:fileId/content',
    async (req, reply) => {
      const { fileId } = req.params;
      if (!isUuid(fileId)) throw notFound('File');
      const [file] = await db.select().from(files).where(and(eq(files.id, fileId), isNull(files.deletedAt))).limit(1);
      if (!file) throw notFound('File');
      if (!tokens.verifyFileSignature(fileId, req.query.exp, req.query.sig)) {
        await app.authenticate(req);
        await loadProjectAccess(db, req.userId, file.projectId);
      }
      const object = await storage.get(file.storageKey);
      if (!object) throw notFound('File');

      const disposition = INLINE(file.mimeType) && req.query.download === undefined ? 'inline' : 'attachment';
      reply
        .header('Content-Type', file.mimeType)
        .header('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
        .header('Cache-Control', 'private, max-age=3600')
        .header('Cross-Origin-Resource-Policy', 'cross-origin');
      if (file.mimeType === 'application/pdf') reply.removeHeader('content-security-policy');
      else reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
      if (object.size) reply.header('Content-Length', object.size);
      return reply.send(object.body);
    },
  );
}
