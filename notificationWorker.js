// notificationWorker.js — Process pending notifications and send emails

const { sendEmail } = require('./mailer');

const MAX_ATTEMPTS = 3;

async function processNotifications(db) {
  if (!db) {
    console.error('[WORKER] No database instance provided');
    return;
  }

  try {
    // Fetch pending notifications that haven't exceeded max attempts
    const pending = db.prepare(`
      SELECT id, punch_item_id, recipient_email, subject, body, notify_attempts
      FROM notifications
      WHERE status = 'pending' AND notify_attempts < ?
      ORDER BY created_at ASC
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

        // Send email
        await sendEmail(notif.recipient_email, notif.subject, notif.body);

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
