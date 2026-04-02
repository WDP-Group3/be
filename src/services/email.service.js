import nodemailer from "nodemailer";
import User from "../models/User.js";

// Tạo transporter cho email
// Trong production, nên sử dụng SMTP service như Gmail, SendGrid, Mailgun, etc.
const createTransporter = () => {
  // Nếu có cấu hình SMTP trong .env, sử dụng nó
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Thêm options cho FPT và các server khác
      tls: {
        // Không reject unauthorized certificate (hữu ích cho test)
        rejectUnauthorized: process.env.NODE_ENV === "production",
      },
    });
  }
  // Nếu không có cấu hình, sử dụng mock transporter (chỉ để test, không gửi email thật)
  // Trong production, bắt buộc phải có SMTP config
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "⚠️  Email service: Chưa có cấu hình SMTP. Email sẽ được log ra console.",
    );
    // Trả về một mock transporter để không bị lỗi
    return {
      sendMail: async (options) => {
        console.log("📧 [MOCK EMAIL] To:", options.to);
        console.log("📧 [MOCK EMAIL] Subject:", options.subject);
        const urlMatch = options.html.match(/href="([^"]+)"/);
        if (urlMatch) {
          console.log("📧 [MOCK EMAIL] Reset URL:", urlMatch[1]);
        }
        return {
          messageId: "mock-" + Date.now(),
          accepted: [options.to],
        };
      },
    };
  }

  // Production: throw error nếu không có config
  throw new Error(
    "Email service chưa được cấu hình. Vui lòng cấu hình SMTP trong .env",
  );
};

/**
 * Gửi email cấp mật khẩu mới
 * @param {string} email - Email người nhận
 * @param {string} newPassword - Mật khẩu mới được tạo
 */
export const sendPasswordResetEmail = async (email, newPassword) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: process.env.SMTP_FROM || "noreply@drivecenter.com",
      to: email,
      subject: "Cấp lại mật khẩu mới - Drive Center",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .password-box { background: #e2e8f0; border-radius: 8px; font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #1e293b; padding: 15px; text-align: center; margin: 20px 0; border: 1px dashed #94a3b8; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Drive Center</h1>
              <p>Mật khẩu mới của bạn</p>
            </div>
            <div class="content">
              <p>Xin chào,</p>
              <p>Hệ thống đã nhận được yêu cầu cài đặt lại mật khẩu cho tài khoản của bạn.</p>
              <p>Dưới đây là mật khẩu mới được tạo tự động để bạn đăng nhập:</p>
              <div class="password-box">
                ${newPassword}
              </div>
              <p><strong>Bảo mật:</strong> Vui lòng đăng nhập và bảo vệ tài khoản bằng cách đổi lại mật khẩu này sang mật khẩu dễ nhớ của riêng bạn trong phần Tài khoản của tôi.</p>
              <p>Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email hoặc liên hệ ngay với ban quản trị.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Drive Center. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Mật khẩu mới - Drive Center
        
        Hệ thống đã nhận được yêu cầu cài đặt lại mật khẩu cho tài khoản của bạn.
        Mật khẩu mới của bạn là: ${newPassword}
        
        Vui lòng đăng nhập và đổi lại mật khẩu của riêng bạn thiết lập.
        
        © ${new Date().getFullYear()} Drive Center. All rights reserved.
      `,
    };

    const info = await transporter.sendMail(mailOptions);

    // Log success
    if (info.messageId && info.messageId.startsWith("mock-")) {
      console.log("✅ Email đã được xử lý (mock mode)");
    } else {
      console.log("✅ Email đã được gửi thành công:", info.messageId);
    }

    return { success: true, messageId: info.messageId };
  } catch (error) {
    throw new Error("Không thể gửi email. Vui lòng thử lại sau.");
  }
};

/**
 * Gửi email thông báo
 * @param {string} email - Email người nhận
 * @param {string} title - Tiêu đề thông báo
 * @param {string} message - Nội dung thông báo
 */
export const sendNotificationEmail = async (email, title, message) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: process.env.SMTP_FROM || '"Drive Center" <noreply@drivecenter.com>',
      to: email,
      subject: `${title} - Drive Center`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); color: white; padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
            .content { background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
            .notification-badge { display: inline-block; padding: 6px 12px; background: #e3f2fd; color: #1976d2; border-radius: 20px; font-size: 12px; font-weight: bold; margin-bottom: 20px; }
            .footer { text-align: center; margin-top: 25px; color: #888; font-size: 13px; }
            h1 { margin: 0; font-size: 24px; font-weight: 600; }
            p { margin-bottom: 15px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Drive Center</h1>
              <p style="margin: 10px 0 0; opacity: 0.9;">Hệ thống quản lý trung tâm sát hạch lái xe</p>
            </div>
            <div class="content">
              <div class="notification-badge">THÔNG BÁO MỚI</div>
              <p>Xin chào,</p>
              <p>Bạn có một thông báo mới từ hệ thống:</p>
              
              <div style="background-color: #f8f9fa; border-left: 4px solid #1e3c72; padding: 15px 20px; margin: 25px 0; border-radius: 4px;">
                <h3 style="margin-top: 0; color: #1e3c72;">${title}</h3>
                <p style="margin-bottom: 0;">${message}</p>
              </div>

              <p>Vui lòng đăng nhập vào hệ thống để xem chi tiết.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Drive Center. All rights reserved.</p>
              <p>Đây là email tự động, vui lòng không phản hồi email này.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        THÔNG BÁO MỚI TỪ DRIVE CENTER
        
        ${title}
        
        ${message}
        
        Vui lòng đăng nhập vào hệ thống để xem chi tiết.
        
        © ${new Date().getFullYear()} Drive Center. All rights reserved.
      `,
    };

    const info = await transporter.sendMail(mailOptions);

    if (info.messageId && info.messageId.startsWith("mock-")) {
      console.log(
        `✅ [Notification] Email đã được gửi tới ${email} (mock mode)`,
      );
    } else {
      console.log(
        `✅ [Notification] Email đã được gửi thành công tới ${email}:`,
        info.messageId,
      );
    }

    return { success: true, messageId: info.messageId };
  } catch (error) {
    // Không throw error để tránh làm gián đoạn luồng chính nếu gửi mail thất bại
    return { success: false, error: error.message };
  }
};

export const sendNotificationMailToRoles = async ({
  roles = [],
  title,
  message,
}) => {
  try {
    const users = await User.find({
      status: "ACTIVE",
      role: { $in: roles },
    }).select("email");


    for (const user of users) {
      if (user.email) {
        await sendNotificationEmail(user.email, title, message);
      }
    }
  } catch (error) {
    throw error;
  }
};

export const sendApprovalEmail = async (email, roleName) => {
  const title = "Yêu cầu đăng ký tài khoản đã được duyệt";
  const message = `Chúc mừng! Tài khoản của bạn đã được duyệt lên quyền **${roleName}**. Vui lòng đăng nhập lại để trải nghiệm các tính năng mới.`;
  return sendNotificationEmail(email, title, message);
};

export const sendRejectionEmail = async (email, roleName) => {
  const title = "Yêu cầu đăng ký tài khoản bị từ chối";
  const message = `Rất tiếc, yêu cầu nâng quyền lên **${roleName}** của bạn đã bị từ chối. Tài khoản của bạn vẫn giữ quyền Học viên.`;
  return sendNotificationEmail(email, title, message);
};

/**
 * Gửi email nhắc học phí trước hạn
 * @param {string} email
 * @param {object} data - { learnerName, courseName, installmentName, amount, dueDate, daysLeft }
 */
export const sendFeeReminderBeforeEmail = async (email, data) => {
  const { learnerName, courseName, installmentName, amount, dueDate, daysLeft } = data;
  const amountStr = Number(amount).toLocaleString('vi-VN');
  const dueDateStr = new Date(dueDate).toLocaleDateString('vi-VN', {
    weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric',
  });

  const isUrgent = daysLeft <= 1;
  const title = isUrgent
    ? '⚠️ THƯA GẤP: Hạn đóng học phí vào NGÀY MAI!'
    : `⏰ Nhắc nhở: Hạn đóng học phí còn ${daysLeft} ngày`;

  const urgencyColor = isUrgent ? '#f59e0b' : '#2563eb';
  const urgencyBg = isUrgent ? '#fef3c7' : '#dbeafe';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); color: white; padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
    .content { background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .urgency-banner { background: ${urgencyBg}; border-left: 4px solid ${urgencyColor}; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }
    .urgency-text { color: ${urgencyColor}; font-size: 18px; font-weight: bold; margin: 0; }
    .detail-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .detail-table td { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
    .detail-table td:first-child { color: #666; width: 40%; }
    .detail-table td:last-child { font-weight: 600; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .footer { text-align: center; margin-top: 25px; color: #888; font-size: 13px; }
    h1 { margin: 0; font-size: 24px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Drive Center</h1>
      <p style="margin: 10px 0 0; opacity: 0.9;">Nhắc nhở đóng học phí</p>
    </div>
    <div class="content">
      <p>Xin chào <strong>${learnerName}</strong>,</p>
      <p>Hệ thống ghi nhận bạn có một đợt đóng học phí sắp đến hạn.</p>

      <div class="urgency-banner">
        <p class="urgency-text">⏰ Còn ${daysLeft === 1 ? 'NGÀY MAI' : daysLeft + ' ngày'} — Hạn đóng: ${dueDateStr}</p>
      </div>

      <table class="detail-table">
        <tr><td>Khóa học</td><td>${courseName}</td></tr>
        <tr><td>Đợt đóng tiền</td><td>${installmentName}</td></tr>
        <tr><td>Số tiền</td><td style="color:#1e3c72;">${amountStr} VND</td></tr>
        <tr><td>Hạn đóng</td><td>${dueDateStr}</td></tr>
      </table>

      <p>Vui lòng đóng tiền đúng hạn để không ảnh hưởng đến lịch học và quá trình thi cử.</p>

      <center>
        <a href="https://drivecenter.com/portal/payments" class="cta-button">Đóng tiền ngay</a>
      </center>

      <p>Nếu bạn đã đóng tiền, vui lòng bỏ qua email này hoặc liên hệ bộ phận tư vấn.</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Drive Center. All rights reserved.</p>
      <p>Đây là email tự động, vui lòng không phản hồi email này.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
NHẮC NHỞ ĐÓNG HỌC PHÍ — Drive Center

Kính gửi ${learnerName},

Bạn có một đợt đóng học phí sắp đến hạn trong ${daysLeft === 1 ? 'NGÀY MAI' : daysLeft + ' ngày'}!

Thông tin đóng phí:
- Khóa học: ${courseName}
- Đợt: ${installmentName}
- Số tiền: ${amountStr} VND
- Hạn đóng: ${dueDateStr}

Vui lòng đóng tiền đúng hạn để không ảnh hưởng đến lịch học.
Truy cập: https://drivecenter.com/portal/payments

© ${new Date().getFullYear()} Drive Center.`;

  const transporter = createTransporter();
  const mailOptions = {
    from: process.env.SMTP_FROM || '"Drive Center" <noreply@drivecenter.com>',
    to: email,
    subject: `${title} — Drive Center`,
    html,
    text,
  };

  const info = await transporter.sendMail(mailOptions);
  if (info.messageId && info.messageId.startsWith('mock-')) {
    console.log(`✅ [FeeReminder] Email nhắc học phí (${daysLeft} ngày) đã được xử lý cho ${email} (mock mode)`);
  } else {
    console.log(`✅ [FeeReminder] Email nhắc học phí (${daysLeft} ngày) đã gửi tới ${email}`);
  }
  return { success: true, messageId: info.messageId };
};

/**
 * Gửi email nhắc học phí đúng hạn hôm nay
 */
export const sendFeeReminderDueTodayEmail = async (email, data) => {
  const { learnerName, courseName, installmentName, amount, dueDate } = data;
  const amountStr = Number(amount).toLocaleString('vi-VN');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #b45309 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
    .content { background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .alert-banner { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }
    .alert-text { color: #92400e; font-size: 18px; font-weight: bold; margin: 0; }
    .detail-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .detail-table td { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
    .detail-table td:first-child { color: #666; width: 40%; }
    .detail-table td:last-child { font-weight: 600; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #b45309 0%, #d97706 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .footer { text-align: center; margin-top: 25px; color: #888; font-size: 13px; }
    h1 { margin: 0; font-size: 24px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Drive Center</h1>
      <p style="margin: 10px 0 0; opacity: 0.9;">Nhắc nhở đóng học phí</p>
    </div>
    <div class="content">
      <p>Xin chào <strong>${learnerName}</strong>,</p>
      <p>Hệ thống nhắc nhở bạn: <strong>hạn đóng học phí là HÔM NAY!</strong></p>

      <div class="alert-banner">
        <p class="alert-text">⚠️ HẠN ĐÓNG HỌC PHÍ HÔM NAY!</p>
      </div>

      <table class="detail-table">
        <tr><td>Khóa học</td><td>${courseName}</td></tr>
        <tr><td>Đợt đóng tiền</td><td>${installmentName}</td></tr>
        <tr><td>Số tiền</td><td style="color:#b45309;">${amountStr} VND</td></tr>
      </table>

      <p>Vui lòng đóng tiền <strong>NGAY HÔM NAY</strong> để không ảnh hưởng đến quá trình học tập.</p>

      <center>
        <a href="https://drivecenter.com/portal/payments" class="cta-button">Đóng tiền ngay</a>
      </center>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Drive Center. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
⚠️ HẠN ĐÓNG HỌC PHÍ HÔM NAY! — Drive Center

Kính gửi ${learnerName},

Hạn đóng học phí là HÔM NAY!

- Khóa học: ${courseName}
- Đợt: ${installmentName}
- Số tiền: ${amountStr} VND

Vui lòng đóng tiền ngay hôm nay.
Truy cập: https://drivecenter.com/portal/payments

© ${new Date().getFullYear()} Drive Center.`;

  const transporter = createTransporter();
  const mailOptions = {
    from: process.env.SMTP_FROM || '"Drive Center" <noreply@drivecenter.com>',
    to: email,
    subject: `⚠️ HẠN ĐÓNG HỌC PHÍ HÔM NAY! — Drive Center`,
    html,
    text,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`✅ [FeeReminder] Email hạn đóng hôm nay đã gửi tới ${email}`);
  return { success: true, messageId: info.messageId };
};

/**
 * Gửi email nhắc học phí quá hạn
 * @param {string} email
 * @param {object} data - { learnerName, courseName, installmentName, amount, dueDate, daysOverdue }
 */
export const sendFeeReminderOverdueEmail = async (email, data) => {
  const { learnerName, courseName, installmentName, amount, dueDate, daysOverdue } = data;
  const amountStr = Number(amount).toLocaleString('vi-VN');
  const dueDateStr = new Date(dueDate).toLocaleDateString('vi-VN', {
    day: 'numeric', month: 'numeric', year: 'numeric',
  });

  const isCritical = daysOverdue >= 7;
  const title = isCritical
    ? '🚨 KHẨN CẤP: Học phí quá hạn ' + daysOverdue + ' ngày!'
    : daysOverdue === 1
    ? '⚠️ THƯA BẠN: Hạn đóng học phí đã quá hạn 1 ngày'
    : `⚠️ CẢNH BÁO: Học phí quá hạn ${daysOverdue} ngày`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${isCritical ? 'linear-gradient(135deg, #991b1b 0%, #dc2626 100%)' : 'linear-gradient(135deg, #b91c1c 0%, #ef4444 100%)'}; color: white; padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
    .content { background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .alert-banner { background: #fee2e2; border-left: 4px solid #dc2626; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }
    .alert-text { color: #991b1b; font-size: 18px; font-weight: bold; margin: 0; }
    .warning-text { color: #dc2626; font-size: 14px; font-weight: 600; margin: 10px 0 0; }
    .detail-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .detail-table td { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
    .detail-table td:first-child { color: #666; width: 40%; }
    .detail-table td:last-child { font-weight: 600; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #991b1b 0%, #dc2626 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .footer { text-align: center; margin-top: 25px; color: #888; font-size: 13px; }
    h1 { margin: 0; font-size: 24px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Drive Center</h1>
      <p style="margin: 10px 0 0; opacity: 0.9;">Thông báo quá hạn đóng học phí</p>
    </div>
    <div class="content">
      <p>Xin chào <strong>${learnerName}</strong>,</p>
      <p>Hệ thống ghi nhận bạn có <strong>đợt đóng học phí đã quá hạn</strong>.</p>

      <div class="alert-banner">
        <p class="alert-text">⚠️ Đã quá hạn ${daysOverdue} ngày!</p>
        <p class="warning-text">Vui lòng đóng tiền ngay để tránh ảnh hưởng đến lịch thi và hồ sơ.</p>
      </div>

      <table class="detail-table">
        <tr><td>Khóa học</td><td>${courseName}</td></tr>
        <tr><td>Đợt đóng tiền</td><td>${installmentName}</td></tr>
        <tr><td>Số tiền</td><td style="color:#dc2626;">${amountStr} VND</td></tr>
        <tr><td>Hạn đóng (quá)</td><td style="color:#dc2626;">${dueDateStr}</td></tr>
      </table>

      <p>Vui lòng đóng tiền <strong>ngay hôm nay</strong> để tránh bị tạm ngưng lịch học và không được tham gia thi.</p>

      <center>
        <a href="https://drivecenter.com/portal/payments" class="cta-button">Đóng tiền ngay</a>
      </center>

      <p>Nếu bạn đã đóng tiền, vui lòng bỏ qua email này hoặc liên hệ bộ phận tư vấn.</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Drive Center. All rights reserved.</p>
      <p>Đây là email tự động, vui lòng không phản hồi email này.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
⚠️ THƯA BẠN: Học phí đã QUÁ HẠN ${daysOverdue} ngày! — Drive Center

Kính gửi ${learnerName},

Bạn có đợt đóng học phí đã QUÁ HẠN ${daysOverdue} ngày!

- Khóa học: ${courseName}
- Đợt: ${installmentName}
- Số tiền: ${amountStr} VND
- Hạn đóng (đã quá): ${dueDateStr}

Vui lòng đóng tiền ngay hôm nay để tránh ảnh hưởng đến lịch thi.
Truy cập: https://drivecenter.com/portal/payments

© ${new Date().getFullYear()} Drive Center.`;

  const transporter = createTransporter();
  const mailOptions = {
    from: process.env.SMTP_FROM || '"Drive Center" <noreply@drivecenter.com>',
    to: email,
    subject: `${title} — Drive Center`,
    html,
    text,
  };

  const info = await transporter.sendMail(mailOptions);
  if (info.messageId && info.messageId.startsWith('mock-')) {
    console.log(`✅ [FeeReminder] Email quá hạn (${daysOverdue} ngày) đã được xử lý cho ${email} (mock mode)`);
  } else {
    console.log(`✅ [FeeReminder] Email quá hạn (${daysOverdue} ngày) đã gửi tới ${email}`);
  }
  return { success: true, messageId: info.messageId };
};

/**
 * Gửi email báo admin khi học viên quá hạn học phí
 * @param {string} email
 * @param {object} data - { learnerName, learnerEmail, courseName, installmentName, amount, dueDate, daysOverdue }
 */
export const sendFeeOverdueAdminEmail = async (email, data) => {
  const { learnerName, learnerEmail, courseName, installmentName, amount, dueDate, daysOverdue } = data;
  const amountStr = Number(amount).toLocaleString('vi-VN');
  const dueDateStr = new Date(dueDate).toLocaleDateString('vi-VN', {
    day: 'numeric', month: 'numeric', year: 'numeric',
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #991b1b 0%, #dc2626 100%); color: white; padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
    .content { background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .alert-banner { background: #fee2e2; border-left: 4px solid #dc2626; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }
    .alert-text { color: #991b1b; font-size: 18px; font-weight: bold; margin: 0; }
    .detail-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .detail-table td { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
    .detail-table td:first-child { color: #666; width: 40%; }
    .detail-table td:last-child { font-weight: 600; }
    .footer { text-align: center; margin-top: 25px; color: #888; font-size: 13px; }
    h1 { margin: 0; font-size: 24px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Drive Center</h1>
      <p style="margin: 10px 0 0; opacity: 0.9;">[ADMIN] Học viên quá hạn học phí</p>
    </div>
    <div class="content">
      <div class="alert-banner">
        <p class="alert-text">🚨 Học viên quá hạn học phí ${daysOverdue} ngày!</p>
      </div>

      <table class="detail-table">
        <tr><td>Học viên</td><td>${learnerName}</td></tr>
        <tr><td>Email</td><td>${learnerEmail}</td></tr>
        <tr><td>Khóa học</td><td>${courseName}</td></tr>
        <tr><td>Đợt quá hạn</td><td>${installmentName}</td></tr>
        <tr><td>Số tiền</td><td style="color:#dc2626;">${amountStr} VND</td></tr>
        <tr><td>Hạn đóng</td><td>${dueDateStr}</td></tr>
        <tr><td>Số ngày quá hạn</td><td style="color:#dc2626; font-weight:bold;">${daysOverdue} ngày</td></tr>
      </table>

      <p>Vui lòng kiểm tra và liên hệ học viên để xử lý.</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Drive Center. Email tự động từ hệ thống.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
🚨 [ADMIN] Học viên quá hạn học phí ${daysOverdue} ngày! — Drive Center

Học viên: ${learnerName}
Email: ${learnerEmail}
Khóa học: ${courseName}
Đợt: ${installmentName}
Số tiền: ${amountStr} VND
Hạn đóng: ${dueDateStr}
Số ngày quá hạn: ${daysOverdue} ngày

Vui lòng kiểm tra và liên hệ học viên để xử lý.

© ${new Date().getFullYear()} Drive Center.`;

  const transporter = createTransporter();
  const mailOptions = {
    from: process.env.SMTP_FROM || '"Drive Center" <noreply@drivecenter.com>',
    to: email,
    subject: `🚨 [ADMIN] Học viên quá hạn học phí: ${learnerName} - ${courseName} - Đợt ${installmentName}`,
    html,
    text,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`✅ [FeeReminder] Email báo admin đã gửi tới ${email}`);
  return { success: true, messageId: info.messageId };
};
