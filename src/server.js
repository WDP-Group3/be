import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { connectDB } from "./config/db.js";
import apiRoutes from "./routes/index.js";
import {
  initCloudinary,
  isCloudinaryConfigured,
  pingCloudinary,
} from "./services/cloudinary.service.js";
import {
  startFridayReminderCron,
  startAttendanceReminderCron,
  sendInstructorBusyScheduleReminder,
} from "./services/cron.job.js";
import { initSocket } from "./services/socket.service.js";
import Booking from "./models/Booking.js";
import { sendNotificationEmail } from "./services/email.service.js";

// Load environment variables
dotenv.config({ path: new URL("../.env", import.meta.url).pathname });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(
  cors({
    // Cho phép các nguồn này truy cập vào API
    origin: [
      process.env.FRONTEND_URL,
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "https://fe-git-main-nthm1806s-projects.vercel.app",
    ].filter(Boolean), // .filter(Boolean) để loại bỏ giá trị undefined nếu biến môi trường chưa có
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Quan trọng: Phải đặt app.use(express.json()) ở phía dưới CORS
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Kết nối MongoDB
connectDB();

// Cloudinary (optional)
initCloudinary();
if (isCloudinaryConfigured()) {
  console.log("☁️  Cloudinary: CLOUDINARY_URL is set");
} else {
  console.log("☁️  Cloudinary: not configured (CLOUDINARY_URL is missing)");
}

// Khởi động cron job nhắc nhở giáo viên (17:30 thứ 6)
startFridayReminderCron();

// Khởi động cron job nhắc nhở điểm danh (chạy mỗi 5 phút)
startAttendanceReminderCron();

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to Backend API",
    status: "success",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    database: "connected",
    cloudinaryConfigured: isCloudinaryConfigured(),
    timestamp: new Date().toISOString(),
  });
});

// [TEST] Route gửi email nhắc nhở lịch bận cho giáo viên - gọi bằng trình duyệt
const handleTestScheduleReminder = async (req, res) => {
  try {
    await sendInstructorBusyScheduleReminder("Thứ 6 (test)");

    res.json({
      status: "success",
      message: "✅ Test email nhắc nhở lịch bận hoàn tất!",
    });
  } catch (error) {
    console.error("❌ [TEST] Lỗi gửi email nhắc nhở lịch bận:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};
app.get("/test-email-schedule-reminder", handleTestScheduleReminder);
app.get("/test-email-schedule-remind", handleTestScheduleReminder); // Alias (thiếu "er")

// [TEST] Route gửi email nhắc nhở điểm danh - gọi bằng trình duyệt
app.get("/test-email-attendance", async (req, res) => {
  const SLOT_END_TIMES = {
    1: { hour: 8, minute: 0 },
    2: { hour: 9, minute: 30 },
    3: { hour: 11, minute: 0 },
    4: { hour: 12, minute: 30 },
    5: { hour: 14, minute: 0 },
    6: { hour: 15, minute: 30 },
    7: { hour: 17, minute: 0 },
    8: { hour: 18, minute: 30 },
    9: { hour: 20, minute: 0 },
    10: { hour: 21, minute: 30 },
  };

  const SLOT_LABELS = {
    1: "Ca 1 (07:00 - 08:00)",
    2: "Ca 2 (08:30 - 09:30)",
    3: "Ca 3 (10:00 - 11:00)",
    4: "Ca 4 (11:30 - 12:30)",
    5: "Ca 5 (13:00 - 14:00)",
    6: "Ca 6 (14:30 - 15:30)",
    7: "Ca 7 (16:00 - 17:00)",
    8: "Ca 8 (17:30 - 18:30)",
    9: "Ca 9 (19:00 - 20:00)",
    10: "Ca 10 (20:30 - 21:30)",
  };

  try {
    const bookings = await Booking.find({
      status: "BOOKED",
      attendanceReminderSent: false, // Chỉ gửi email nếu chưa gửi
      $or: [
        { attendance: { $exists: false } }, // Chưa từng có attendance
        { attendance: "PENDING" }, // Đã có nhưng chưa điểm danh
      ],
    })
      .populate("learnerId", "fullName email phone")
      .populate("instructorId", "fullName email phone");

    let reminderCount = 0;
    let instructorEmails = [];
    let learnerEmails = [];

    for (const booking of bookings) {
      const { hour, minute } = SLOT_END_TIMES[String(booking.timeSlot)] || {
        hour: 17,
        minute: 0,
      };
      
      const vietnamDate = new Date(booking.date.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
      const classYear = vietnamDate.getFullYear();
      const classMonth = String(vietnamDate.getMonth() + 1).padStart(2, '0');
      const classDateStr = String(vietnamDate.getDate()).padStart(2, '0');
      const classHrStr = String(hour).padStart(2, '0');
      const classMnStr = String(minute).padStart(2, '0');
      
      const absoluteEndTimeStr = `${classYear}-${classMonth}-${classDateStr}T${classHrStr}:${classMnStr}:00+07:00`;
      const classEndTime = new Date(absoluteEndTimeStr);
      
      const reminderTime = new Date(classEndTime.getTime() + 5 * 60 * 1000);
      const now = new Date();

      if (now >= reminderTime) {
        const classDateStr = new Date(booking.date).toLocaleDateString(
          "vi-VN",
          {
            weekday: "long",
            day: "numeric",
            month: "numeric",
            year: "numeric",
          },
        );

        // Email cho GV
        if (booking.instructorId?.email) {
          const title = "⏰ [TEST] Nhắc nhở: Buổi học chưa được điểm danh";
          const message = `Kính gửi Quý Thầy/Cô,

Đây là email TEST nhắc nhở điểm danh từ hệ thống.

Buổi học ngày ${classDateStr} ${SLOT_LABELS[String(booking.timeSlot)] || "Ca " + booking.timeSlot} đã kết thúc nhưng Thầy/Cô chưa thực hiện điểm danh.

Thông tin buổi học:
- Ngày: ${classDateStr}
- Ca: ${SLOT_LABELS[String(booking.timeSlot)] || "Ca " + booking.timeSlot}
- Học viên: ${booking.learnerId?.fullName || "N/A"}
- SĐT học viên: ${booking.learnerId?.phone || "N/A"}

Truy cập hệ thống để điểm danh: https://drivecenter.com/portal/instructor-schedule

Trân trọng!`;
          await sendNotificationEmail(
            booking.instructorId.email,
            title,
            message,
          );
          instructorEmails.push(booking.instructorId.email);
          console.log(
            `✅ [TEST] Đã gửi email cho GV: ${booking.instructorId.email}`,
          );
        }

        // Email cho HV
        if (booking.learnerId?.email) {
          const title = "⏰ [TEST] Nhắc nhở: Buổi học chưa được điểm danh";
          const message = `Kính gửi Học viên,

Đây là email TEST nhắc nhở điểm danh từ hệ thống.

Buổi học ngày ${classDateStr} đã kết thúc nhưng chưa được điểm danh.

Vui lòng liên hệ giáo viên để được điểm danh.

Trân trọng!`;
          await sendNotificationEmail(booking.learnerId.email, title, message);
          learnerEmails.push(booking.learnerId.email);
          console.log(
            `✅ [TEST] Đã gửi email cho HV: ${booking.learnerId.email}`,
          );
        }

        // Đánh dấu đã gửi email nhắc nhở (chỉ gửi 1 lần duy nhất)
        await Booking.findByIdAndUpdate(booking._id, {
          attendanceReminderSent: true,
        });

        reminderCount++;
      }
    }

    res.json({
      status: "success",
      message: `✅ Test hoàn tất! Đã gửi ${reminderCount} email nhắc nhở`,
      totalBookingsFound: bookings.length,
      emailsSent: reminderCount,
      instructorEmails,
      learnerEmails,
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// Cloudinary health check (pings Cloudinary API)
app.get("/health/cloudinary", async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        status: "error",
        message: "Cloudinary is not configured (missing CLOUDINARY_URL)",
      });
    }

    const result = await pingCloudinary();
    return res.json({
      status: "success",
      data: result,
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: err?.message || "Cloudinary ping failed",
    });
  }
});

// API Routes
app.use("/api", apiRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
    status: "error",
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    message: err.message || "Internal Server Error",
    status: "error",
  });
});

// Khởi chạy server
const httpServer = createServer(app);

// Bật Socket.io server thông qua socket.service.js để các controller gọi được io
initSocket(httpServer);

const server = httpServer.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
});

server.on("error", (err) => {
  if (err?.code === "EADDRINUSE") {
    console.error(
      `❌ Port ${PORT} đang được sử dụng. Hãy tắt tiến trình đang dùng port hoặc đổi PORT trong .env.`,
    );
  } else {
    console.error("Server error:", err);
  }
});
