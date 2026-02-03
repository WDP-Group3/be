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

