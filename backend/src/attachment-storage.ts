import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Response } from "express";
import { config, HttpError } from "./context.js";
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  preservePath: true,
});
const allowed: Record<string, string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
};
export async function storeUpload(input: Express.Multer.File | undefined) {
  const file = input;
  if (!file || !file.buffer.length) throw new HttpError(400, "请选择文件");
  // Multipart's legacy Latin-1 parameter decoding can otherwise corrupt UTF-8 filenames.
  const decoded = Buffer.from(file.originalname, "latin1").toString("utf8");
  const filename = (
    Buffer.from(decoded, "utf8").toString("latin1") === file.originalname
      ? decoded
      : file.originalname
  ).normalize("NFC");
  if (
    filename.length > 180 ||
    /[\\/\x00-\x1f\x7f]/.test(filename) ||
    filename.startsWith(".") ||
    /\.(exe|html?|svg|js|mjs|php|sh|bat|cmd|com|scr|ps1)(\.|$)/i.test(filename)
  )
    throw new HttpError(400, "不安全的文件名");
  const actual = await fileTypeFromBuffer(file.buffer).catch(() => undefined);
  if (
    !actual ||
    !allowed[actual.mime]?.includes(path.extname(filename).toLowerCase())
  )
    throw new HttpError(400, "文件内容与扩展名不符，或类型不受支持");
  if (
    file.mimetype !== actual.mime &&
    file.mimetype !== "application/octet-stream"
  )
    throw new HttpError(400, "文件 MIME 类型不匹配");
  const storageKey = `${randomUUID()}.${actual.ext}`;
  const directory = path.resolve(config.uploadDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filepath = path.join(directory, storageKey);
  await writeFile(filepath, file.buffer, { flag: "wx", mode: 0o600 });
  return {
    filename,
    mimeType: actual.mime,
    size: file.size,
    storageKey,
    filepath,
  };
}
export function sendAttachment(
  res: Response,
  attachment: { storageKey: string; filename: string; mimeType: string },
) {
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/.test(attachment.storageKey))
    throw new HttpError(404, "文件不存在");
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader(
    "Content-Disposition",
    `${attachment.mimeType.startsWith("image/") ? "inline" : "attachment"}; filename="download.${path.extname(attachment.filename).slice(1)}"; filename*=UTF-8''${encodeURIComponent(attachment.filename).replace(/'/g, "%27")}`,
  );
  res.sendFile(
    attachment.storageKey,
    { root: path.resolve(config.uploadDir), dotfiles: "deny" },
    (error) => {
      if (error && !res.headersSent)
        res.status(404).json({ error: "文件不存在" });
    },
  );
}
