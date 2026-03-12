import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
  }
};

const Registration = mongoose.model('Registration', new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', default: null },
    registerMethod: String,
    status: String,
    paymentPlanType: String,
    feePlanSnapshot: Array,
    createdAt: Date
}, { timestamps: false, strict: false }));

const Course = mongoose.model('Course', new mongoose.Schema({
    code: String,
    name: String,
}, { timestamps: false, strict: false }));

const runMigration = async () => {
  await connectDB();
  
  try {
    // Attempt to find a default course
    const defaultCourse = await Course.findOne({ code: 'B Tự Động (B1)' }) || await Course.findOne();
    if (!defaultCourse) {
        console.error('No courses found in the database. Cannot migrate.');
        process.exit(1);
    }
    
    console.log(`Using default Course ID: ${defaultCourse._id} (${defaultCourse.code})`);

    // Find registrations missing courseId
    const missingCourseIdFilters = [
        { courseId: { $exists: false } },
        { courseId: null }
    ];

    const count = await Registration.countDocuments({ $or: missingCourseIdFilters });
    console.log(`Found ${count} registrations missing courseId.`);

    if (count > 0) {
        const result = await Registration.updateMany(
            { $or: missingCourseIdFilters },
            { $set: { courseId: defaultCourse._id } }
        );
        console.log(`Migrated ${result.modifiedCount} registrations.`);
    } else {
        console.log('Nothing to migrate.');
    }
    
  } catch (error) {
     console.error('Migration failed:', error);
  } finally {
     mongoose.connection.close();
     process.exit(0);
  }
};

runMigration();
