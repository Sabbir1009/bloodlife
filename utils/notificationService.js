const logger = require('./logger');

class NotificationService {
  getSender() {
    const configuredSender = process.env.EMAIL_FROM || 'BloodLife <noreply@bloodlife.com>';
    const match = configuredSender.match(/^(.*?)\s*<([^>]+)>$/);

    return match
      ? { name: match[1].trim() || 'BloodLife', email: match[2].trim() }
      : { name: 'BloodLife', email: configuredSender.trim() };
    }

    async sendEmail(to, subject, html) {
        try {
      const apiKey = process.env.BREVO_API_KEY;
      if (!apiKey) {
        logger.warn('BREVO_API_KEY not configured, skipping email send');
                return { success: false, message: 'Email not configured' };
            }

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify({
          sender: this.getSender(),
          to: [{ email: to }],
          subject,
          htmlContent: html
        })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = result.message || `HTTP ${response.status}`;
        logger.error(`Brevo email send failed: ${message}`);
        return { success: false, error: message };
      }

      logger.info(`Email sent through Brevo: ${result.messageId || 'accepted'}`);
      return { success: true, messageId: result.messageId };
        } catch (error) {
      logger.error(`Brevo email send failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async notifyDonorMatch(donorEmail, donorName, requestDetails) {
        const emergency = requestDetails.is_emergency;
        const subject = emergency
            ? '🚨 URGENT Blood Request — Your Help Needed Now!'
            : '🩸 Blood Donation Request — You Can Save a Life';

        const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

        <!-- Header -->
        <tr>
          <td style="background:${emergency ? '#b91c1c' : '#dc2626'};padding:28px 40px;text-align:center;">
            ${emergency ? '<div style="background:rgba(255,255,255,.2);display:inline-block;padding:4px 14px;border-radius:999px;color:#fff;font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:10px;">⚠️ EMERGENCY</div><br>' : ''}
            <h1 style="margin:0;color:#fff;font-size:26px;font-weight:800;">🩸 BloodLife</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:14px;">Urgent Blood Donation Request</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 28px;">
            <p style="margin:0 0 6px;font-size:15px;color:#374151;">Hello <strong>${donorName}</strong>,</p>
            <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.7;">
              A patient urgently needs blood that matches your group. <strong>Your single donation can save their life.</strong>
            </p>

            <!-- Blood group highlight -->
            <div style="text-align:center;margin-bottom:24px;">
              <div style="display:inline-block;background:#fef2f2;border:2px solid #fecaca;border-radius:16px;padding:16px 40px;">
                <p style="margin:0;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Blood Group Needed</p>
                <p style="margin:6px 0 0;font-size:42px;font-weight:800;color:#dc2626;line-height:1;">${requestDetails.blood_group}</p>
              </div>
            </div>

            <!-- Details table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#f9fafb;">
                <td style="padding:12px 16px;font-size:13px;color:#6b7280;width:40%;">👤 Patient</td>
                <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#111827;">${requestDetails.patient_name}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:12px 16px;font-size:13px;color:#6b7280;">🏥 Hospital</td>
                <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#111827;">${requestDetails.hospital}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;background:#f9fafb;">
                <td style="padding:12px 16px;font-size:13px;color:#6b7280;">💉 Units Needed</td>
                <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#111827;">${requestDetails.units} unit(s)</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:12px 16px;font-size:13px;color:#6b7280;">📅 Date Needed</td>
                <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#111827;">${new Date(requestDetails.needed_date).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;background:#f9fafb;">
                <td style="padding:12px 16px;font-size:13px;color:#6b7280;">📞 Contact</td>
                <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#111827;">${requestDetails.phone}</td>
              </tr>
            </table>

            <p style="margin:0 0 24px;font-size:13px;color:#6b7280;text-align:center;">
              Please call the hospital directly if you are available to donate.
            </p>

            <div style="text-align:center;">
              <a href="tel:${requestDetails.phone}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-size:15px;font-weight:700;">📞 Call Hospital Now</a>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">© 2025 BloodLife · You received this because you are a registered donor.</p>
            <p style="margin:4px 0 0;font-size:12px;color:#9ca3af;">To stop receiving alerts, update your availability in your <a href="${process.env.APP_URL || 'https://bloodlife-production.up.railway.app'}/donor-dashboard.html" style="color:#dc2626;">donor dashboard</a>.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

        return await this.sendEmail(donorEmail, subject, html);
    }

    async notifyRequestStatusUpdate(requesterId, status, requestDetails) {
        const statusMessages = {
            'Approved': 'has been approved',
            'Fulfilled': 'has been fulfilled',
            'Rejected': 'could not be processed at this time'
        };

        const subject = `Blood Request ${status}`;
        const html = `
            <h2>Blood Request Update</h2>
            <p>Your blood request for <strong>${requestDetails.blood_group}</strong> ${statusMessages[status]}.</p>
            <h3>Request Details:</h3>
            <ul>
                <li><strong>Patient:</strong> ${requestDetails.patient_name}</li>
                <li><strong>Blood Group:</strong> ${requestDetails.blood_group}</li>
                <li><strong>Units:</strong> ${requestDetails.units}</li>
                <li><strong>Hospital:</strong> ${requestDetails.hospital}</li>
            </ul>
            <p>Thank you for using BloodLife.</p>
        `;

        return await this.sendEmail(requesterId, subject, html);
    }

    async sendWelcomeEmail(email, name) {
        const subject = 'Welcome to BloodLife 🩸';
        const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr>
          <td style="background:#dc2626;padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;letter-spacing:-0.5px;">🩸 BloodLife</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:14px;">Blood Donation Management</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;">
            <h2 style="margin:0 0 12px;color:#111827;font-size:22px;font-weight:700;">Welcome, ${name}! 👋</h2>
            <p style="margin:0 0 20px;color:#4b5563;font-size:15px;line-height:1.7;">
              Thank you for joining <strong>BloodLife</strong>. Your decision to register as a blood donor can <strong>save up to 3 lives</strong> with a single donation.
            </p>
            <!-- Info cards -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="background:#fef2f2;border-radius:10px;padding:16px 18px;width:48%;">
                  <p style="margin:0;font-size:13px;color:#6b7280;">Next step</p>
                  <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#111827;">Complete your profile</p>
                </td>
                <td width="4%"></td>
                <td style="background:#f0fdf4;border-radius:10px;padding:16px 18px;width:48%;">
                  <p style="margin:0;font-size:13px;color:#6b7280;">Donation interval</p>
                  <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#111827;">Every 90 days</p>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 28px;color:#4b5563;font-size:14px;line-height:1.7;">
              We'll send you a notification whenever there's an urgent blood request matching your blood group. You can update your availability anytime from your donor dashboard.
            </p>
            <a href="${process.env.APP_URL || 'https://bloodlife-production.up.railway.app'}/login.html" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-size:15px;font-weight:600;">Go to Dashboard →</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">© 2025 BloodLife · You received this because you created an account.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
        return await this.sendEmail(email, subject, html);
    }
}

module.exports = new NotificationService();
