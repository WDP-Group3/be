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
  console.log("SMTP HOST:", process.env.SMTP_HOST);
  console.log("SMTP USER:", process.env.SMTP_USER);
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
 * Gửi email đặt lại mật khẩu
 * @param {string} email - Email người nhận
 * @param {string} resetToken - Token để đặt lại mật khẩu
 * @param {string} resetUrl - URL để đặt lại mật khẩu
 */
export const sendPasswordResetEmail = async (email, resetToken, resetUrl) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: process.env.SMTP_FROM || "noreply@drivecenter.com",
      to: email,
      subject: "Đặt lại mật khẩu - Drive Center",
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
            .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Drive Center</h1>
              <p>Đặt lại mật khẩu</p>
            </div>
            <div class="content">
              <p>Xin chào,</p>
              <p>Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản của mình.</p>
              <p>Vui lòng click vào nút bên dưới để đặt lại mật khẩu:</p>
              <div style="text-align: center;">
                <a href="${resetUrl}" class="button">Đặt lại mật khẩu</a>
              </div>
              <p>Hoặc copy link sau vào trình duyệt:</p>
              <p style="word-break: break-all; color: #667eea;">${resetUrl}</p>
              <p><strong>Lưu ý:</strong> Link này sẽ hết hạn sau 1 giờ.</p>
              <p>Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Drive Center. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Đặt lại mật khẩu - Drive Center
        
        Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản của mình.
        
        Vui lòng truy cập link sau để đặt lại mật khẩu:
        ${resetUrl}
        
        Link này sẽ hết hạn sau 1 giờ.
        
        Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.
        
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
    console.error("Error sending email:", error);
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
    console.error(`❌ [Notification] Lỗi gửi email tới ${email}:`, error);
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

    console.log(
      `📢 Sending notification email to ${users.length} users with roles: ${roles.join(", ")}`,
    );

    for (const user of users) {
      if (user.email) {
        await sendNotificationEmail(user.email, title, message);
      }
    }
  } catch (error) {
    console.error("❌ Error sending notification emails:", error);
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