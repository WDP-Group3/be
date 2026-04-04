import { v2 as cloudinary } from 'cloudinary';

/**
 * Cloudinary auto-reads CLOUDINARY_URL if present.
 * We still call config({ secure: true }) so returned URLs are https.
 */
export function initCloudinary() {
  cloudinary.config({ secure: true });
  return cloudinary;
}

export function isCloudinaryConfigured() {
  // CLOUDINARY_URL is the simplest signal
  return !!process.env.CLOUDINARY_URL;
}

export async function pingCloudinary() {
  // Requires API credentials; CLOUDINARY_URL provides them
  return await cloudinary.api.ping();
}

/**
 * Upload a file to Cloudinary using server-side upload.
 * Accepts a file path (from Multer disk storage) or a data URI string.
 * Requires CLOUDINARY_URL to be configured.
 *
 * @param {string} filePathOrUri - Absolute file path or data URI
 * @param {{ folder?: string }} options
 * @returns {Promise<{ secure_url: string, public_id: string, width?: number, height?: number }>}
 */
export async function uploadFile(filePathOrUri, options = {}) {
  const { folder = 'documents' } = options;

  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary chưa được cấu hình (CLOUDINARY_URL missing)');
  }

  const result = await cloudinary.uploader.upload(filePathOrUri, {
    folder,
    use_filename: true,
    unique_filename: true,
    overwrite: false,
  });

  return {
    secure_url: result.secure_url,
    public_id: result.public_id,
    width: result.width,
    height: result.height,
  };
}
