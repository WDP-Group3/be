import nodemailer from 'nodemailer';

// Tạo transporter cho email
// Trong production, nên sử dụng SMTP service như Gmail, SendGrid, Mailgun, etc.
const createTransporter = () => {
  // Nếu có cấu hình SMTP trong .env, sử dụng nó
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Thêm options cho FPT và các server khác
      tls: {
        // Không reject unauthorized certificate (hữu ích cho test)
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    });
  }

  // Nếu không có cấu hình, sử dụng mock transporter (chỉ để test, không gửi email thật)
  // Trong production, bắt buộc phải có SMTP config
  if (process.env.NODE_ENV !== 'production') {
    console.warn('⚠️  Email service: Chưa có cấu hình SMTP. Email sẽ được log ra console.');
    // Trả về một mock transporter để không bị lỗi
    return {
      sendMail: async (options) => {
        console.log('📧 [MOCK EMAIL] To:', options.to);
        console.log('📧 [MOCK EMAIL] Subject:', options.subject);
        const urlMatch = options.html.match(/href="([^"]+)"/);
        if (urlMatch) {
          console.log('📧 [MOCK EMAIL] Reset URL:', urlMatch[1]);
        }
        return {
          messageId: 'mock-' + Date.now(),
          accepted: [options.to],
        };
      },
    };
  }

  // Production: throw error nếu không có config
  throw new Error('Email service chưa được cấu hình. Vui lòng cấu hình SMTP trong .env');
};


/**
 * Gửi email thông báo mật khẩu mới
 * @param {string} email - Email người nhận
 * @param {string} newPassword - Mật khẩu mới
 */
export const sendNewPasswordEmail = async (email, newPassword) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: process.env.SMTP_FROM || 'ducnahe181063@fpt.edu.vn',
      to: email,
      subject: 'Mật khẩu mới - Drive Center',
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
            .password-box { background: #e2e8f0; padding: 15px; border-radius: 5px; font-family: monospace; font-size: 24px; letter-spacing: 2px; text-align: center; margin: 20px 0; font-weight: bold; color: #4a5568; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Drive Center</h1>
              <p>Cấp lại mật khẩu</p>
            </div>
            <div class="content">
              <p>Xin chào,</p>
              <p>Bạn đã yêu cầu cấp lại mật khẩu mới cho tài khoản của mình.</p>
              <p>Dưới đây là mật khẩu mới của bạn:</p>
              
              <div class="password-box">
                ${newPassword}
              </div>
              
              <p>Vui lòng đăng nhập và đổi lại mật khẩu ngay sau khi đăng nhập để đảm bảo an toàn.</p>
              <p>Nếu bạn không yêu cầu cấp lại mật khẩu, hãy liên hệ ngay với quản trị viên.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Drive Center. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Cấp lại mật khẩu - Drive Center
        
        Bạn đã yêu cầu cấp lại mật khẩu mới cho tài khoản của mình.
        
        Mật khẩu mới của bạn là: ${newPassword}
        
        Vui lòng đăng nhập và đổi lại mật khẩu ngay lập tức.
        
        Nếu bạn không yêu cầu cấp lại mật khẩu, hãy liên hệ ngay với quản trị viên.
        
        © ${new Date().getFullYear()} Drive Center. All rights reserved.
      `,
    };

    const info = await transporter.sendMail(mailOptions);

    // Log success
    if (info.messageId && info.messageId.startsWith('mock-')) {
      console.log('✅ Email mật khẩu mới đã được xử lý (mock mode)');
      console.log('🔑 New Password:', newPassword);
    } else {
      console.log('✅ Email mật khẩu mới đã được gửi thành công:', info.messageId);
    }

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending new password email:', error);
    throw new Error('Không thể gửi email. Vui lòng thử lại sau.');
  }
};
