import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.DB_NAME || 'banglaixe';
/**
 * Kết nối đến MongoDB Atlas bằng Mongoose
 */
export async function connectDB() {
  try {
    // Kiểm tra MONGODB_URI
    if (!MONGODB_URI || MONGODB_URI.trim() === '') {
      console.error('❌ Lỗi: MONGODB_URI chưa được cấu hình!');
      console.error('📝 Vui lòng tạo file .env và thiết lập MONGODB_URI');
      console.error('💡 Xem file .env.example để biết cách cấu hình');
      process.exit(1);
    }

    // Kiểm tra xem đã kết nối chưa
    if (mongoose.connection.readyState === 1) {
      console.log('✅ MongoDB đã được kết nối');
      return;
    }

    // Kết nối đến MongoDB
    await mongoose.connect(MONGODB_URI, {
      dbName: DB_NAME,
      serverSelectionTimeoutMS: 5000,
    });

    console.log('✅ Đã kết nối thành công đến MongoDB Atlas');

    // Xử lý sự kiện disconnect
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ Đã mất kết nối MongoDB');
    });

    // Xử lý lỗi
    mongoose.connection.on('error', (error) => {
      console.error('❌ Lỗi MongoDB:', error);
    });

    // Xử lý khi app tắt
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('✅ Đã đóng kết nối MongoDB');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Lỗi kết nối MongoDB:', error);
    process.exit(1);
  }
}

export default mongoose;

