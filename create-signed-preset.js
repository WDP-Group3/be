/**
 * Script tạo SIGNED upload preset trên Cloudinary.
 *
 * Sự khác biệt với unsigned preset:
 * - Unsigned: ai cũng upload được (frontend dùng upload_preset)
 * - Signed: cần signature từ backend → kiểm soát được ai upload
 *
 * Chạy: node create-signed-preset.js
 */
import 'dotenv/config';
import { v2 as cloudinary } from 'cloudinary';

if (!process.env.CLOUDINARY_URL) {
  console.error('❌ CLOUDINARY_URL is required in .env');
  process.exit(1);
}

cloudinary.config({ secure: true });

async function main() {
  try {
    // Verify connection
    const ping = await cloudinary.api.ping();
    console.log('✅ Cloudinary connected');

    // Create signed preset for documents
    const presets = [
      {
        name: 'drivecenter_signed',
        unsigned: false,
        folder: 'documents',
        tags: ['documents'],
      },
    ];

    for (const preset of presets) {
      try {
        const res = await cloudinary.api.create_upload_preset(preset);
        console.log(`✅ Signed preset "${preset.name}" created in folder "${preset.folder}"`);
        console.log(`   - API Key (public): ${process.env.CLOUDINARY_API_KEY || 'check CLOUDINARY_URL'}`);
      } catch (err) {
        if (err.error?.message?.includes('already exists')) {
          console.log(`ℹ️  Preset "${preset.name}" already exists — skipping`);
        } else {
          console.error(`❌ Error creating "${preset.name}":`, err.error?.message || err.message);
        }
      }
    }

    console.log('\n📋 Signed preset setup complete!');
    console.log('   Frontend cần có VITE_CLOUDINARY_CLOUD_NAME trong .env');
    console.log('   Backend cần có CLOUDINARY_URL trong .env');
    console.log('   Không cần VITE_CLOUDINARY_UPLOAD_PRESET nữa (đã dùng signed)');
  } catch (err) {
    console.error('❌ Fatal error:', err.message);
  }
}

main();
