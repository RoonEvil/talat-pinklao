# Talat Pinklao — Market Stall Booking System

Online stall booking and market zoning for the hospital market at Somdech Phra Pinklao Hospital.
A plain Node.js + Express + SQLite backend, with a static HTML/CSS/JS frontend — no framework,
no build step. This replaces the earlier Claude Artifact version so that everyone who opens the
link sees the exact same, always-current page.

## What's in here

```
server/            Express API + SQLite database
  index.js         serves the API and the frontend
  db.js            schema + seed data
  routes/          one file per resource (auth, zones, stalls, bookings, ...)
  uploads/         payment receipts & the PromptPay QR image (created at runtime)
public/            the frontend (index.html, styles.css, app.js)
render.yaml        one-click config for Render
```

## Local setup (needs Node.js 18+)

```bash
cd server
npm install
npm start
```

Then open http://localhost:4000 — the frontend and API are served from the same address.
Head admin login is seeded automatically: **username `ongsa`, password `GGEZ`** — change the
password once you're live (Staff Admin → Admins doesn't support password changes yet; easiest
is to create a new head admin account and deactivate the old one).

## สรุปขั้นตอนคร่าวๆ (ไม่ต้องติดตั้ง git)

1. สร้าง repo ใหม่บน GitHub (เว็บ ไม่ต้องใช้ git)
2. ลากไฟล์ทั้งโฟลเดอร์นี้ขึ้น GitHub ผ่านหน้าเว็บ (Add file → Upload files)
3. ไปที่ Render.com เชื่อมกับ GitHub repo ที่เพิ่งสร้าง แล้ว deploy
4. ได้ลิงก์ถาวร เช่น `https://talat-pinklao.onrender.com` ที่ทุกคนเห็นหน้าเดียวกัน

รายละเอียดแต่ละขั้นด้านล่าง (เป็นภาษาอังกฤษ เพราะ UI ของเว็บเป็นภาษาอังกฤษ)

## Step 1 — Put this code on GitHub (no git install needed)

1. Go to [github.com/new](https://github.com/new), sign in, and create a new repository
   (e.g. `talat-pinklao`). Keep it **Public** or **Private** — either works with Render.
   Don't add a README/gitignore from GitHub's own template — we already have ours.
2. On the new repo's page, click **"uploading an existing file"** (or **Add file → Upload files**).
3. Drag this entire project folder's contents in. Modern GitHub upload accepts whole folders
   dragged from your file explorer — drag the `server` folder, the `public` folder, and the
   loose files (`.gitignore`, `render.yaml`, `README.md`) all together into the upload area.
4. Scroll down and click **Commit changes**.
5. **Do not upload `server/node_modules`** if you happen to have one locally — it's huge and
   Render installs dependencies itself from `package.json`. The `.gitignore` in this project
   already excludes it if you ever do use git.

## Step 2 — Deploy on Render

1. Go to [render.com](https://render.com) and sign up / log in (you can use your GitHub account).
2. Click **New +** → **Blueprint**, and connect the GitHub repo you just created. Render will
   read `render.yaml` automatically and pre-fill everything (Node service, build/start commands,
   a generated `JWT_SECRET`).
   - If Blueprint isn't available on your plan, use **New +** → **Web Service** instead, pick the
     repo, and set: **Root Directory** = `server`, **Build Command** = `npm install`,
     **Start Command** = `npm start`. Add an environment variable `JWT_SECRET` set to any long
     random string yourself.
3. Click **Create/Deploy**. The first build takes a few minutes (installing `better-sqlite3`
   compiles a small native module — this is normal).
4. Once it's live, Render gives you a permanent URL like `https://talat-pinklao.onrender.com`.
   That's the one link to share — everyone sees the same, current version, no Claude sign-in
   required.

### Known limitation: free-tier storage is temporary

Render's **free** web services use disk storage that resets whenever the service restarts,
redeploys, or spins down from inactivity (free services sleep after ~15 minutes idle and wake
on the next visit, which takes ~30–60 seconds). That means bookings, uploaded receipts, and the
QR image can disappear after a period of inactivity. For a class demo this is usually fine —
just re-open the link before showing it. If you need bookings to persist for real, upgrade the
Render service to a paid plan and add a persistent disk (see the comment in `render.yaml`), or
swap SQLite for a hosted database later.

## Updating the site later

Whenever you want to change something: edit the files, then on GitHub's web UI open the changed
file and use the pencil (edit) icon, or use "Add file → Upload files" again to overwrite it and
commit. Render redeploys automatically on every push to the connected branch.

## Accounts

- **Head admin** (seeded automatically): username `ongsa`, password `GGEZ`. Can manage staff
  accounts (Staff Admin → Admins) and upload the PromptPay QR code (Staff Admin → Settings).
- **Staff accounts**: created by the head admin from Staff Admin → Admins.
- **Vendors**: anyone can browse and book as a guest (no account), or register an account from
  the "Log in" button to have their booking history follow them across devices.
