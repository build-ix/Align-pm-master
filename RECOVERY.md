# Align PM — Failover & Restore

## Backups
- Nightly at 3am: `scripts/nightly-backup.sh` runs `VACUUM INTO` on align.db
- Backups stored at `/srv/align/backups/align-YYYYMMDD.db.gz`
- 7-day rotation (oldest auto-deleted)

## Restore Procedure (under 15 minutes)
1. Stop the server: `systemctl --user stop align-server`
2. Find latest backup: `ls -t /srv/align/backups/align-*.db.gz | head -1`
3. Restore: `gunzip -c LATEST_BACKUP.gz > /srv/align/data/align.db`
4. Start server: `systemctl --user start align-server`
5. Verify: `curl https://alignprojects.net/api/health`

## If the GMKtec Goes Down
- Cloudflare Tunnel drops → alignprojects.net unreachable
- Users see offline message in app
- **No data is lost** — database is on disk
- SSH via Tailscale: `ssh alfr@100.75.7.96`
- Check: `systemctl --user status align-server`, `journalctl --user -u align-server -n 50`
- If disk full: `df -h /srv/align`, run `scripts/cleanup-files.sh`
- If process crashed: systemd auto-restarts in 5 seconds

## If You Need to Rebuild the GMKtec
1. Reinstall Debian 12
2. Clone repo: `git clone https://github.com/build-ix/Align-pm-master /home/alfr/align-pm-master`
3. Restore database from backup (see above)
4. Restore uploads from off-site backup (Backblaze B2 recommended)
5. Reinstall Cloudflare Tunnel: `cloudflared tunnel login`, `cloudflared tunnel create align`
6. Restart services
