import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { fileSchema } from '@brickledger/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { files } from '../../db/schema';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { isUuid } from '../../lib/util';
import { parse } from '../../lib/validate';
import { logActivity } from '../activity';
import { assertStorage } from '../billing/limits';
import { loadProjectAccess, projectAccess, requireRole } from '../projects/access';
import { RESOURCES } from '../resources/registry';
import { serializeRow } from '../resources/service';

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

export async function fileRoutes(app: FastifyInstance) {
  const { db, tokens, storage, config } = app.ctx;
  const maxBytes = config.MAX_UPLOAD_MB * 1024 * 1024;

  /**
   * multipart/form-data: `file` plus optional fields id, name, category, entityType,
   * entityId, expiresOn, notes. Re-sending the same client `id` is idempotent.
   */
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/files', { onRequest: app.authenticate }, async (req, reply) => {
    const access = await projectAccess(req, req.params.projectId);
    requireRole(access, 'contributor', 'upload files');
    if (!req.isMultipart()) throw badRequest('Send the file as multipart/form-data.');

    const fields: Record<string, string> = {};
    let upload: { buffer: Buffer; filename: string; mimetype: string } | null = null;
    try {
      for await (const part of req.parts({ limits: { fileSize: maxBytes, files: 1, fields: 20 } })) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          if (part.file.truncated) throw new AppError(413, 'PAYLOAD_TOO_LARGE', `Files can be up to ${config.MAX_UPLOAD_MB} MB.`);
          upload = { buffer, filename: part.filename || 'upload', mimetype: part.mimetype };
        } else {
          fields[part.fieldname] = String(part.value ?? '');
        }
      }
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err?.code === 'FST_REQ_FILE_TOO_LARGE') throw new AppError(413, 'PAYLOAD_TOO_LARGE', `Files can be up to ${config.MAX_UPLOAD_MB} MB.`);
      throw err;
    }
    if (!upload || upload.buffer.length === 0) throw badRequest('Choose a file to upload.');

    const ext = extname(upload.filename).toLowerCase();
    let mime = upload.mimetype.toLowerCase();
    if (mime === 'application/octet-stream' && CAD_EXTENSIONS.has(ext)) mime = 'application/octet-stream';
    else if (!ALLOWED[mime]) throw badRequest('This file type is not supported. Upload images, PDFs, Office documents or drawings.');
    const storedExt = ALLOWED[mime] ?? ext;

    // Idempotent retry from an offline client.
    const clientId = isUuid(fields.id) ? fields.id : null;
    if (clientId) {
      const [existing] = await db.select().from(files).where(and(eq(files.id, clientId), eq(files.projectId, access.project.id))).limit(1);
      if (existing) return serializeRow(RESOURCES.files, existing, tokens);
    }

    const meta = parse(fileSchema, {
      name: fields.name || upload.filename.replace(/\.[^.]+$/, '') || 'File',
      category: fields.category || (mime.startsWith('image/') ? 'photo' : 'other'),
      entityType: fields.entityType || null,
      entityId: fields.entityId || null,
      expiresOn: fields.expiresOn || null,
      notes: fields.notes || null,
    });

    await assertStorage(db, access.org, upload.buffer.length);
    const id = clientId ?? randomUUID();
    const storageKey = `${access.project.id}/${id}${storedExt}`;
    await storage.put(storageKey, upload.buffer, mime);

    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(files)
        .values({
          ...meta,
          id,
          projectId: access.project.id,
          fileName: upload.filename.slice(0, 200),
          mimeType: mime,
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
