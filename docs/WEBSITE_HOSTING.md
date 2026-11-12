# Put Bite & Brew online as a website

You get an address like `https://bite-and-brew.onrender.com` (or your own domain) that opens
on any phone, tablet or PC. Staff tap **Add to Home Screen** to get an app icon.

## Option A — Render (about 10 minutes, no command line)

1. Put this project in your GitHub account (it already is: `Cafe-app`).
2. Create an account at **render.com** and connect GitHub.
3. **New → Blueprint** → choose the `Cafe-app` repository and the branch → **Apply**.
   Render reads `render.yaml`, builds the app and creates the database. Cost is roughly
   $7/month for the app plus $6/month for the database (check Render's current prices).
4. When the first deploy finishes, open the service → **Environment**:
   - set **WEB_ORIGIN** to your site address (e.g. `https://bite-and-brew.onrender.com`)
   - copy the generated **SETUP_TOKEN**
5. Open your site address. You will see **Create the owner account**: enter the setup code,
   your name, username and a password. Done — then add menu items, staff, VAT, etc.
   (`docs/OWNER_GUIDE.md`).
6. Optional: **Settings → Custom Domains** to use your own address (e.g. `pos.biteandbrew.com`).

## Things to know about a cloud website

- **Internet required.** If the café's internet drops, tills show OFFLINE; a till you allow
  keeps taking cash orders and uploads them later (see OFFLINE.md).
- **Printers:** a cloud server cannot reach printers on the café network. Keep printing
  working by running the print service at the café (see PRINTING.md), or use the on-screen
  Kitchen/Barista displays and the receipt preview until then.
- **Backups:** turn on Render's database backups (paid plans) and also download a copy
  monthly. The `scripts/backup.sh` file works against any PostgreSQL address.
- **Security:** always use the `https://` address. The setup page only works while no account
  exists and only with your setup code.
- Other hosts work too (Railway, Fly.io, any Linux server with Docker) — use the same
  `Dockerfile` and environment variables as in `render.yaml`.
