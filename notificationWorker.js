// notificationWorker.js — Process pending notifications and send emails

const fs = require('fs');
const { sendEmail } = require('./mailer');

const MAX_ATTEMPTS = 3;

async function processNotifications(db) {
  if (!db) {
    console.error('[WORKER] No database instance provided');
    return;
  }

  try {
    // Fetch pending notifications that haven't exceeded max attempts, plus any attachment.
    const pending = db.prepare(`
      SELECT n.id, n.punch_item_id, n.recipient_email, n.subject, n.body, n.notify_attempts,
             n.attachment_file_id, f.stored_path AS attachment_path, f.original_name AS attachment_name
      FROM notifications n
      LEFT JOIN files f ON f.id = n.attachment_file_id
      WHERE n.status = 'pending' AND n.notify_attempts < ?
      ORDER BY n.created_at ASC
      LIMIT 20
    `).all(MAX_ATTEMPTS);

    if (pending.length === 0) {
      return { processed: 0, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const notif of pending) {
      try {
        // Increment attempt counter
        db.prepare(`
          UPDATE notifications SET notify_attempts = notify_attempts + 1 WHERE id = ?
        `).run(notif.id);

        // Build attachment list (list-level notifications carry a PDF).
        const attachments = [];
        if (notif.attachment_file_id) {
          try {
            const content = fs.readFileSync(notif.attachment_path);
            attachments.push({
              filename: notif.attachment_name || 'punchlist.pdf',
              content: content,
              contentType: 'application/pdf'
            });
          } catch (attachErr) {
            console.error(`[WORKER] Missing attachment for notification ${notif.id}:`, attachErr.message);
            throw new Error('Missing PDF attachment');
          }
        }

        // Send email
        await sendEmail(notif.recipient_email, notif.subject, notif.body, attachments);

        // Mark as sent
        db.prepare(`
          UPDATE notifications SET status = 'sent', sent_at = datetime('now') WHERE id = ?
        `).run(notif.id);

        sent++;
        console.log(`[WORKER] ✓ Notification ${notif.id} sent to ${notif.recipient_email}`);
      } catch (err) {
        failed++;
        const errorMsg = err.message || String(err);
        const isFinal = notif.notify_attempts + 1 >= MAX_ATTEMPTS;
        const finalStatus = isFinal ? 'failed' : 'pending';

        db.prepare(`
          UPDATE notifications 
          SET notify_error = ?, status = ?
          WHERE id = ?
        `).run(errorMsg, finalStatus, notif.id);

        console.error(
          `[WORKER] ✗ Notification ${notif.id} attempt ${notif.notify_attempts + 1}/${MAX_ATTEMPTS}:`,
          errorMsg
        );

        if (isFinal) {
          console.error(`[WORKER] ✗ Notification ${notif.id} FAILED permanently after ${MAX_ATTEMPTS} attempts`);
        }
      }
    }

    return { processed: pending.length, sent, failed };
  } catch (err) {
    console.error('[WORKER] Unexpected error in processNotifications:', err.message);
    return { processed: 0, sent: 0, failed: 0, error: err.message };
  }
}

module.exports = { processNotifications };
