// mailer.js — SendGrid email via nodemailer

const nodemailer = require('nodemailer');

let transporter = null;

function initMailer() {
  if (transporter) return transporter;
  
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || 'noreply@alignprojects.net';
  
  if (!apiKey) {
    console.warn('[MAILER] No SENDGRID_API_KEY in env — emails will fail');
  }
  
  transporter = nodemailer.createTransport({
    host: 'smtp.sendgrid.net',
    port: 587,
    auth: {
      user: 'apikey',
      pass: apiKey || 'dummy'
    }
  });
  
  return transporter;
}

async function sendEmail(to, subject, text) {
  const mailer = initMailer();
  const fromEmail = process.env.FROM_EMAIL || 'noreply@alignprojects.net';
  
  try {
    const info = await mailer.sendMail({
      from: fromEmail,
      to,
      subject,
      text
    });
    return { success: true, info };
  } catch (err) {
    const msg = err.message || String(err);
    console.error(`[MAILER] Failed to send to ${to}:`, msg);
    throw new Error(`Email send failed: ${msg}`);
  }
}

module.exports = { sendEmail };
