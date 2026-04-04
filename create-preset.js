import 'dotenv/config';
import { v2 as cloudinary } from 'cloudinary';
import { config as cloudinaryConfig } from 'cloudinary/lib/config';

if (!process.env.CLOUDINARY_URL) {
  console.error('❌ CLOUDINARY_URL is required in .env');
  process.exit(1);
}

cloudinary.config({ secure: true });

async function main() {
  try {
    // Parse CLOUDINARY_URL to extract parts
    const url = new URL(process.env.CLOUDINARY_URL);
    const cloudName = url.hostname.split('.')[0];
    const apiKey = url.username;
    const apiSecret = url.password;

    // Verify config
    const ping = await cloudinary.api.ping();
    console.log(`✅ Cloudinary connected as: ${cloudName}`);

    const res = await cloudinary.api.create_upload_preset({
      name: 'drivecenter_preset',
      unsigned: true,
      folder: 'course_images',
    });
    console.log('✅ Unsigned upload preset "drivecenter_preset" created:', res.name);

    // Create a signed preset for documents (safer for personal docs)
    const docRes = await cloudinary.api.create_upload_preset({
      name: 'drivecenter_documents',
      unsigned: false,
      folder: 'documents',
      tags: ['documents'],
    });
    console.log('✅ Signed upload preset "drivecenter_documents" created:', docRes.name);

  } catch (err) {
    if (err.error && err.error.message && err.error.message.includes('already exists')) {
      console.log('ℹ️  Upload preset "drivecenter_preset" already exists — skipping');
      console.log('ℹ️  Upload preset "drivecenter_documents" already exists — skipping');
    } else {
      console.error('❌ Error:', err.message || err);
    }
  }
}

main();
